package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Files from the customer's phone come two ways, each with its own QR Code:
//   - store Wi-Fi (local_upload.go): the phone sends straight to this device, nothing leaves the store;
//   - 4G/5G (this file): over the internet. The kiosk opens a session on the imprime.ai server, the phone
//     uploads there, the kiosk downloads each file and deletes it from the server. Sessions last
//     30 minutes and are closed (files deleted) when the customer finishes or leaves.

const maxUploadBytes = 50 << 20

var relayHTTP = &http.Client{Timeout: 90 * time.Second}

func relayBase() string {
	if u := os.Getenv("QUIOCO_RELAY_URL"); u != "" { // tests only
		return strings.TrimRight(u, "/")
	}
	return "https://imprime-ai.vercel.app"
}

// Item is one file received from a phone; the kiosk screen shows and prints it.
type Item struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"` // image or pdf
	path string
}

// RelayUpload is one open "Do celular" session on the imprime.ai server (4G/5G option).
type RelayUpload struct {
	app    *App
	code   string
	secret string
	URL    string
	stop   chan struct{}
	once   sync.Once
	seen   map[string]bool
}

type relayFile struct {
	Pathname string `json:"pathname"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
}

func randomToken() string {
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
	b := []byte(randomB64(16))
	out := make([]byte, 10)
	for i := range out {
		out[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(out)
}

const noInternet = "Sem conexão com a internet. Confira a internet deste aparelho e tente de novo."

func (app *App) openRelay() (*RelayUpload, string) {
	app.closeRelay()
	body, _ := json.Marshal(map[string]string{"kioskName": app.store.Read().Settings.KioskName})
	resp, err := relayHTTP.Post(relayBase()+"/api/relay/session", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, noInternet
	}
	defer resp.Body.Close()
	var out struct {
		Code   string `json:"code"`
		Secret string `json:"secret"`
		URL    string `json:"url"`
		Error  string `json:"error"`
	}
	json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out)
	if resp.StatusCode != 200 || out.Code == "" || out.Secret == "" || out.URL == "" {
		if out.Error != "" {
			return nil, out.Error
		}
		return nil, "Não foi possível abrir o recebimento de arquivos. Tente de novo."
	}
	up := &RelayUpload{app: app, code: out.Code, secret: out.Secret, URL: out.URL, stop: make(chan struct{}), seen: map[string]bool{}}
	app.mu.Lock()
	app.relay = up
	app.mu.Unlock()
	go up.poll()
	return up, ""
}

func (app *App) closeRelay() {
	app.mu.Lock()
	up := app.relay
	app.relay = nil
	app.mu.Unlock()
	if up != nil {
		up.once.Do(func() { close(up.stop) })
		go up.request("DELETE", "", nil) // deletes whatever is left on the server
	}
}

func (up *RelayUpload) active() bool {
	select {
	case <-up.stop:
		return false
	default:
		return true
	}
}

// request calls /api/relay/session/<code><suffix> with the session secret.
func (up *RelayUpload) request(method, suffix string, query url.Values) (*http.Response, error) {
	u := relayBase() + "/api/relay/session/" + up.code + suffix
	if query != nil {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequest(method, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+up.secret)
	resp, err := relayHTTP.Do(req)
	if err == nil && method == "DELETE" {
		resp.Body.Close()
	}
	return resp, err
}

func (up *RelayUpload) poll() {
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-up.stop:
			return
		case <-tick.C:
		}
		resp, err := up.request("GET", "/files", nil)
		if err != nil {
			continue // offline for a moment: try again on the next tick
		}
		if resp.StatusCode == 404 {
			resp.Body.Close()
			return // session expired or closed
		}
		var out struct {
			Files []relayFile `json:"files"`
		}
		json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out)
		resp.Body.Close()
		for _, f := range out.Files {
			if !up.active() {
				return
			}
			if up.seen[f.Pathname] {
				continue
			}
			up.seen[f.Pathname] = true
			if msg := up.fetch(f); msg != "" {
				log.Printf("arquivo do celular recusado (%s): %s", f.Name, msg)
			}
		}
	}
}

// fetch downloads one file into the jobs folder, adds it to the screen and deletes it from the server.
func (up *RelayUpload) fetch(f relayFile) string {
	app := up.app
	q := url.Values{"p": {f.Pathname}}
	keep := false // true when the download failed for lack of connection: try again later
	defer func() {
		if !keep {
			up.request("DELETE", "/file", q)
		}
	}()
	app.touch()

	name := clampText(trim(f.Name), 120)
	if name == "" {
		name = "arquivo"
	}
	kind := kindOf(name, "")
	if kind == "" {
		return "Envie apenas fotos ou arquivos PDF."
	}
	if f.Size > maxUploadBytes {
		return "Arquivo grande demais. O limite é 50 MB."
	}
	if app.itemCount()+1 > app.store.Read().Settings.MaxItems {
		return "Limite de itens atingido no quiosque."
	}
	resp, err := up.request("GET", "/file", q)
	if err != nil {
		up.seen[f.Pathname] = false
		keep = true
		return "sem conexão"
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Sprintf("servidor respondeu %d", resp.StatusCode)
	}
	if k := kindOf(name, resp.Header.Get("Content-Type")); k != "" {
		kind = k
	}
	id := randomToken()
	path := filepath.Join(app.jobsDir, id)
	out, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		return "O quiosque não conseguiu guardar o arquivo."
	}
	n, err := io.Copy(out, io.LimitReader(resp.Body, maxUploadBytes+1))
	out.Close()
	if err != nil || n > maxUploadBytes || n == 0 {
		os.Remove(path)
		return "O download foi interrompido."
	}
	if !up.active() {
		os.Remove(path)
		return "atendimento encerrado"
	}
	label := strings.TrimSuffix(name, filepath.Ext(name))
	app.addItem(Item{ID: id, Name: label, Kind: kind, path: path})
	return ""
}

// kindOf says whether a file is a photo ("image") or a PDF ("pdf"), or "" for anything else.
func kindOf(name, mime string) string {
	mime = strings.ToLower(strings.TrimSpace(strings.Split(mime, ";")[0]))
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	switch {
	case mime == "application/pdf" || ext == "pdf":
		return "pdf"
	case strings.HasPrefix(mime, "image/") || contains2([]string{"jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp"}, ext):
		return "image"
	}
	return ""
}

func contains2(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// openUpload opens both ways at once. Either can fail on its own (no Wi-Fi, no internet);
// the screen shows the one that works and explains the other.
func (app *App) openUpload() (local *PhoneUpload, localErr string, relay *RelayUpload, relayErr string) {
	var wg sync.WaitGroup
	if !freeEdition { // 4G/5G is part of the paid imprime.ai; imprime-free uses the store Wi-Fi only
		wg.Add(1)
		go func() { defer wg.Done(); relay, relayErr = app.openRelay() }()
	}
	local, localErr = app.openLocalUpload()
	wg.Wait()
	return
}

func (app *App) closeUpload() {
	app.closeLocalUpload()
	app.closeRelay()
}
