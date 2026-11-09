package main

import (
	_ "embed"
	"encoding/json"
	"html"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

//go:embed ui/upload.html
var uploadPage string

const maxUploadBytes = 50 << 20

const expiredPage = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Link expirado</title></head>
<body style="font:18px/1.5 -apple-system,Roboto,sans-serif;padding:32px;color:#18212b;background:#f2f4f7">
<h1 style="font-size:24px">Este link expirou</h1>
<p>Toque em <b>Do celular</b> na tela do quiosque e leia o QR Code de novo.</p></body></html>`

// Item is one file received from a phone; the kiosk screen shows and prints it.
type Item struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"` // image or pdf
	path string
}

// PhoneUpload is the page on the store's network that the customer's phone opens from the QR Code.
// Only the address with this session's random token works, and only while the panel is open.
type PhoneUpload struct {
	mu       sync.Mutex
	app      *App
	token    string
	listener net.Listener
	server   *http.Server
	URL      string
}

func localIPv4() string {
	if ip := os.Getenv("QUIOCO_LAN_IP"); ip != "" { // tests only
		return ip
	}
	conn, err := net.Dial("udp", "8.8.8.8:80") // no packet is sent; it only picks the outgoing interface
	if err == nil {
		defer conn.Close()
		if a, ok := conn.LocalAddr().(*net.UDPAddr); ok && a.IP.IsPrivate() {
			return a.IP.String()
		}
	}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && n.IP.IsPrivate() {
			return n.IP.String()
		}
	}
	return ""
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

func (app *App) openUpload() (*PhoneUpload, string) {
	app.closeUpload()
	ip := localIPv4()
	if ip == "" {
		return nil, "Este computador não está conectado à rede da loja. Conecte-o ao Wi-Fi ou ao cabo de rede e tente de novo."
	}
	ln, err := net.Listen("tcp4", ":0")
	if err != nil {
		return nil, "Não foi possível abrir o recebimento de arquivos. Tente de novo."
	}
	up := &PhoneUpload{app: app, token: randomToken(), listener: ln}
	up.URL = "http://" + ip + ":" + strconv.Itoa(ln.Addr().(*net.TCPAddr).Port) + "/u/" + up.token
	mux := http.NewServeMux()
	mux.HandleFunc("/", up.handle)
	up.server = &http.Server{Handler: mux, ReadHeaderTimeout: 15e9}
	go up.server.Serve(ln)
	app.mu.Lock()
	app.upload = up
	app.mu.Unlock()
	return up, ""
}

func (app *App) closeUpload() {
	app.mu.Lock()
	up := app.upload
	app.upload = nil
	app.mu.Unlock()
	if up != nil {
		up.server.Close()
	}
}

func (up *PhoneUpload) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	base := "/u/" + up.token
	switch {
	case r.Method == "GET" && (r.URL.Path == base || r.URL.Path == base+"/"):
		name := html.EscapeString(up.app.store.Read().Settings.KioskName)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, strings.ReplaceAll(uploadPage, "{{KIOSK}}", name))
	case r.Method == "POST" && r.URL.Path == base+"/upload":
		up.receive(w, r)
	default:
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(404)
		io.WriteString(w, expiredPage)
	}
}

func uploadReply(w http.ResponseWriter, status int, ok bool, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"ok": ok, "message": message})
}

func (up *PhoneUpload) receive(w http.ResponseWriter, r *http.Request) {
	app := up.app
	app.touch()
	if r.ContentLength <= 0 {
		uploadReply(w, 411, false, "Envio inválido. Tente de novo.")
		return
	}
	if r.ContentLength > maxUploadBytes {
		uploadReply(w, 413, false, "Arquivo grande demais. O limite é 50 MB.")
		return
	}
	name := clampText(trim(r.URL.Query().Get("name")), 120)
	if name == "" {
		name = "arquivo"
	}
	mime := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	kind := ""
	switch {
	case mime == "application/pdf" || ext == "pdf":
		kind = "pdf"
	case strings.HasPrefix(mime, "image/") || contains2([]string{"jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp"}, ext):
		kind = "image"
	default:
		uploadReply(w, 422, false, "Envie apenas fotos ou arquivos PDF.")
		return
	}
	up.mu.Lock()
	full := app.itemCount()+1 > app.store.Read().Settings.MaxItems
	up.mu.Unlock()
	if full {
		uploadReply(w, 422, false, "Limite de itens atingido no quiosque.")
		return
	}
	id := randomToken()
	path := filepath.Join(app.jobsDir, id)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		uploadReply(w, 500, false, "O quiosque não conseguiu guardar o arquivo.")
		return
	}
	n, err := io.Copy(f, io.LimitReader(r.Body, maxUploadBytes+1))
	f.Close()
	if err != nil || n != r.ContentLength {
		os.Remove(path)
		uploadReply(w, 400, false, "O envio foi interrompido. Tente de novo.")
		return
	}
	label := strings.TrimSuffix(name, filepath.Ext(name))
	item := Item{ID: id, Name: label, Kind: kind, path: path}
	app.addItem(item)
	uploadReply(w, 200, true, "Enviado")
}

func contains2(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
