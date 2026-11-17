package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// A fake imprime.ai relay: one session with one PDF waiting.
func TestPhoneFilesArriveOverTheInternet(t *testing.T) {
	var mu sync.Mutex
	files := map[string][]byte{"relay/abc/x1/Boleto.pdf": []byte("%PDF-1.4 teste")}
	closed := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path == "/api/relay/session" && r.Method == "POST" {
			json.NewEncoder(w).Encode(map[string]string{"code": "abc", "secret": "segredo-bem-comprido-123", "url": "https://imprime.ai/e/abc"})
			return
		}
		if r.Header.Get("Authorization") != "Bearer segredo-bem-comprido-123" {
			w.WriteHeader(404)
			return
		}
		switch {
		case r.URL.Path == "/api/relay/session/abc/files":
			list := []map[string]any{}
			for p, b := range files {
				list = append(list, map[string]any{"pathname": p, "name": filepath.Base(p), "size": len(b)})
			}
			json.NewEncoder(w).Encode(map[string]any{"files": list})
		case r.URL.Path == "/api/relay/session/abc/file" && r.Method == "GET":
			w.Header().Set("Content-Type", "application/pdf")
			w.Write(files[r.URL.Query().Get("p")])
		case r.URL.Path == "/api/relay/session/abc/file" && r.Method == "DELETE":
			delete(files, r.URL.Query().Get("p"))
		case r.URL.Path == "/api/relay/session/abc" && r.Method == "DELETE":
			closed = true
		}
	}))
	defer srv.Close()
	os.Setenv("QUIOCO_RELAY_URL", srv.URL)
	defer os.Unsetenv("QUIOCO_RELAY_URL")

	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store, dir: dir, jobsDir: t.TempDir(), lastTouch: time.Now()}
	up, msg := app.openRelay()
	if up == nil || up.URL != "https://imprime.ai/e/abc" {
		t.Fatalf("session not opened: %q", msg)
	}
	deadline := time.Now().Add(8 * time.Second)
	for app.itemCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if app.itemCount() != 1 {
		t.Fatal("the PDF did not reach the kiosk")
	}
	it := app.items[0]
	if it.Kind != "pdf" || it.Name != "Boleto" {
		t.Fatalf("unexpected item %+v", it)
	}
	if b, _ := os.ReadFile(it.path); string(b) != "%PDF-1.4 teste" {
		t.Fatal("file content differs")
	}
	time.Sleep(200 * time.Millisecond)
	mu.Lock()
	left := len(files)
	mu.Unlock()
	if left != 0 {
		t.Fatal("the file must be deleted from the server after download")
	}
	app.closeUpload()
	time.Sleep(300 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if !closed {
		t.Fatal("closing must end the session on the server")
	}
}
