package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func main() {
	dir := dataDir()
	store, err := OpenStore(dir)
	if err != nil {
		log.Fatal(err)
	}
	if f, err := os.OpenFile(filepath.Join(dir, "quioco.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		log.SetOutput(f)
	}
	jobs := filepath.Join(dir, "arquivos")
	os.RemoveAll(jobs) // files from a previous session are never kept
	os.MkdirAll(jobs, 0o700)

	app := &App{store: store, dir: dir, jobsDir: jobs, key: randomB64(24), lastTouch: time.Now()}

	// Only this computer reaches the kiosk screen; a second copy of imprime.ai just exits.
	ln, err := net.Listen("tcp4", "127.0.0.1:"+uiPort)
	if err != nil {
		log.Print("imprime.ai já está aberto: ", err)
		return
	}
	server := &http.Server{Handler: app.routes(), ReadHeaderTimeout: 10 * time.Second}
	go app.syncLoop()
	if os.Getenv("QUIOCO_NO_BROWSER") == "" {
		go app.runBrowser("http://127.0.0.1:" + uiPort + "/")
	}
	log.Print("imprime.ai ", appVersion, " em http://127.0.0.1:", uiPort)
	log.Fatal(server.Serve(ln))
}
