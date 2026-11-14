package main

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const appVersion = "1.0.0"

//go:embed ui
var uiFiles embed.FS

type App struct {
	store      *Store
	dir        string
	jobsDir    string
	key        string // required on every local API call; only the kiosk page knows it
	syncMu     sync.Mutex
	mu         sync.Mutex
	items      []Item
	upload     *PhoneUpload
	syncError  string
	lastTouch  time.Time
	adminUntil time.Time
	payments   map[string]*payment
	browser    *exec.Cmd
	quitting   bool
}

func (app *App) touch() {
	app.mu.Lock()
	app.lastTouch = time.Now()
	app.mu.Unlock()
}

func (app *App) itemCount() int {
	app.mu.Lock()
	defer app.mu.Unlock()
	return len(app.items)
}

func (app *App) addItem(it Item) {
	app.mu.Lock()
	app.items = append(app.items, it)
	app.mu.Unlock()
}

func (app *App) clearItems() {
	app.mu.Lock()
	items := app.items
	app.items = nil
	app.mu.Unlock()
	for _, it := range items {
		os.Remove(it.path)
	}
}

func (app *App) token() string {
	sealed := app.store.Read().SealedToken
	if sealed == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return ""
	}
	plain, err := openSecret(raw)
	if err != nil {
		return ""
	}
	return string(plain)
}

func (app *App) pixReady() bool {
	return strings.Contains(app.store.Read().Settings.PayerEmail, "@") && app.token() != ""
}

// blockedMessage used to stop printing after the trial; now the kiosk keeps working and
// prints carry the imprime.ai watermark instead (see watermarked), so nothing is blocked.
func blockedMessage(lic License) string {
	return ""
}

// watermarked: after the free trial (or when the subscription lapses) every page is printed
// with the "imprime.ai" watermark until the kiosk is licensed again.
func watermarked(lic License) bool {
	return lic.State == "demoOver" || lic.State == "expired"
}

// ---------------------------------------------------------------- HTTP plumbing

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) bool {
	return json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(v) == nil
}

func (app *App) adminOK() bool {
	app.mu.Lock()
	defer app.mu.Unlock()
	if time.Now().After(app.adminUntil) {
		return false
	}
	app.adminUntil = time.Now().Add(10 * time.Minute)
	return true
}

func init() {
	// The Windows registry may not know these; the page's modules need the right type.
	mime.AddExtensionType(".mjs", "text/javascript")
	mime.AddExtensionType(".js", "text/javascript")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mime.AddExtensionType(".css", "text/css")
}

func (app *App) routes() http.Handler {
	mux := http.NewServeMux()
	static, _ := fs.Sub(uiFiles, "ui")
	files := http.FileServer(http.FS(static))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			files.ServeHTTP(w, r)
			return
		}
		page, _ := uiFiles.ReadFile("ui/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write([]byte(strings.Replace(string(page), "{{KEY}}", app.key, 1)))
	})

	mux.HandleFunc("/files/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("k") != app.key {
			http.NotFound(w, r)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/files/")
		app.mu.Lock()
		var found *Item
		for i := range app.items {
			if app.items[i].ID == id {
				found = &app.items[i]
			}
		}
		app.mu.Unlock()
		if found == nil {
			http.NotFound(w, r)
			return
		}
		if found.Kind == "pdf" {
			w.Header().Set("Content-Type", "application/pdf")
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, found.path)
	})

	api := func(path string, admin bool, h func(w http.ResponseWriter, r *http.Request)) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Kiosk-Key") != app.key {
				http.Error(w, "forbidden", 403)
				return
			}
			app.touch()
			if admin && !app.adminOK() {
				writeJSON(w, 401, map[string]string{"error": "Configurações bloqueadas. Digite o PIN de novo."})
				return
			}
			h(w, r)
		})
	}

	api("/api/state", false, app.apiState)
	api("/api/wifi-qr", false, func(w http.ResponseWriter, r *http.Request) {
		s := app.store.Read().Settings
		if trim(s.WifiName) == "" {
			writeJSON(w, 200, map[string]any{})
			return
		}
		q, _ := EncodeQR(wifiPayload(s.WifiName, s.WifiPassword))
		writeJSON(w, 200, map[string]any{"svg": q.SVG(), "name": s.WifiName, "password": s.WifiPassword})
	})

	// Customer flow
	api("/api/upload/open", false, func(w http.ResponseWriter, r *http.Request) {
		up, msg := app.openUpload()
		if up == nil {
			writeJSON(w, 200, map[string]any{"error": msg})
			return
		}
		q, _ := EncodeQR(up.URL)
		writeJSON(w, 200, map[string]any{"url": up.URL, "svg": q.SVG()})
	})
	api("/api/upload/close", false, func(w http.ResponseWriter, r *http.Request) {
		app.closeUpload()
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	api("/api/items", false, func(w http.ResponseWriter, r *http.Request) {
		app.mu.Lock()
		list := append([]Item{}, app.items...)
		app.mu.Unlock()
		writeJSON(w, 200, map[string]any{"items": list})
	})
	api("/api/items/remove", false, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ ID string }
		readJSON(r, &in)
		app.mu.Lock()
		for i, it := range app.items {
			if it.ID == in.ID {
				os.Remove(it.path)
				app.items = append(app.items[:i], app.items[i+1:]...)
				break
			}
		}
		app.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	api("/api/reset", false, func(w http.ResponseWriter, r *http.Request) {
		app.closeUpload()
		app.clearItems()
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	api("/api/checkout", false, app.apiCheckout)
	api("/api/pay/status", false, app.apiPayStatus)
	api("/api/pay/cancel", false, app.apiPayCancel)
	api("/api/print/done", false, app.apiPrintDone)
	api("/api/methods", false, app.apiMethods)
	api("/api/voucher/redeem", false, app.apiVoucherRedeem)

	// Staff settings
	api("/api/admin/pin", false, app.apiSetPin)
	api("/api/admin/unlock", false, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Pin string }
		readJSON(r, &in)
		if app.store.Read().PinHash == "" {
			writeJSON(w, 200, map[string]any{"error": "Crie o PIN primeiro."})
			return
		}
		if msg := app.checkPin(in.Pin); msg != "" {
			writeJSON(w, 200, map[string]any{"error": msg})
			return
		}
		app.mu.Lock()
		app.adminUntil = time.Now().Add(10 * time.Minute)
		app.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	api("/api/admin/lock", false, func(w http.ResponseWriter, r *http.Request) {
		app.mu.Lock()
		app.adminUntil = time.Time{}
		app.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	api("/api/admin/info", true, app.apiAdminInfo)
	api("/api/admin/settings", true, func(w http.ResponseWriter, r *http.Request) {
		var in Settings
		if !readJSON(r, &in) {
			writeJSON(w, 400, map[string]string{"error": "Dados inválidos."})
			return
		}
		app.store.Update(func(s *State) { s.Settings = sanitizeSettings(in) })
		go app.Sync()
		writeJSON(w, 200, map[string]any{"ok": true, "settings": app.store.Read().Settings})
	})
	api("/api/admin/token", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Token string }
		readJSON(r, &in)
		token := strings.TrimPrefix(strings.Join(strings.Fields(in.Token), ""), "Bearer")
		if token == "" {
			app.store.Update(func(s *State) { s.SealedToken = "" })
			writeJSON(w, 200, map[string]any{"ok": true})
			return
		}
		sealed, err := sealSecret([]byte(token))
		if err != nil {
			writeJSON(w, 200, map[string]any{"error": "Não foi possível guardar o token com segurança neste computador."})
			return
		}
		app.store.Update(func(s *State) { s.SealedToken = base64.StdEncoding.EncodeToString(sealed) })
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	api("/api/admin/test-mp", true, func(w http.ResponseWriter, r *http.Request) {
		token := app.token()
		if token == "" {
			writeJSON(w, 200, map[string]any{"error": "Salve o token primeiro."})
			return
		}
		name, err := mpAccountName(token)
		if err != nil {
			writeJSON(w, 200, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"message": "Conectado à conta " + name + "."})
	})
	api("/api/admin/activate", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Code string }
		readJSON(r, &in)
		code := strings.Join(strings.Fields(in.Code), "")
		until := verifyLicense(code, app.store.storeID())
		if until < 0 {
			writeJSON(w, 200, map[string]any{"error": "Código inválido para este quiosque. Confira o código da loja."})
			return
		}
		app.store.Update(func(s *State) { s.LicenseCode = code })
		writeJSON(w, 200, map[string]any{"message": "Assinatura ativa até " + dayDate(until).Format("02/01/2006") + "."})
	})
	api("/api/admin/sync", true, func(w http.ResponseWriter, r *http.Request) {
		app.Sync()
		app.apiAdminInfo(w, r)
	})
	api("/api/admin/printer", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Name string }
		readJSON(r, &in)
		if err := setDefaultPrinter(in.Name); err != nil {
			writeJSON(w, 200, map[string]any{"error": err.Error()})
			return
		}
		app.store.Update(func(s *State) { s.Printer = in.Name })
		app.apiAdminInfo(w, r)
	})
	api("/api/admin/autostart", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ On bool }
		readJSON(r, &in)
		if err := setAutostart(in.On); err != nil {
			writeJSON(w, 200, map[string]any{"error": "Não foi possível mudar a abertura automática."})
			return
		}
		app.apiAdminInfo(w, r)
	})
	api("/api/admin/point/list", true, func(w http.ResponseWriter, r *http.Request) {
		list, err := pointTerminals(app.token())
		if err != nil {
			writeJSON(w, 200, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"terminals": list})
	})
	api("/api/admin/point/set", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ ID string }
		readJSON(r, &in)
		id := strings.TrimSpace(in.ID)
		if id != "" {
			if err := pointSetPDV(app.token(), id); err != nil {
				writeJSON(w, 200, map[string]any{"error": err.Error()})
				return
			}
		}
		app.store.Update(func(s *State) { s.PointTerminal = id })
		app.apiAdminInfo(w, r)
	})
	api("/api/admin/quit", true, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
		go func() {
			time.Sleep(300 * time.Millisecond)
			app.quit()
		}()
	})
	return mux
}

func (app *App) apiState(w http.ResponseWriter, r *http.Request) {
	st := app.store.Read()
	lic := app.license()
	settings := st.Settings
	edition := map[string]any{"name": appName(), "free": freeEdition}
	if freeEdition {
		settings.PricePerPageCents = 0 // always free, whatever was saved
		edition["adUrl"] = freeAdURL
		edition["adQr"] = freeAdQR()
	}
	writeJSON(w, 200, map[string]any{
		"edition":    edition,
		"settings":   settings,
		"license":    lic,
		"blocked":    blockedMessage(lic),
		"watermark":  watermarked(lic),
		"pixReady":   app.pixReady(),
		"pinSet":     st.PinHash != "",
		"version":    appVersion,
		"priceLabel": priceLabel,
	})
}

func (app *App) apiAdminInfo(w http.ResponseWriter, r *http.Request) {
	st := app.store.Read()
	printers, perr := listPrinters()
	token := app.token()
	suffix := ""
	if len(token) > 6 {
		suffix = token[len(token)-6:]
	}
	app.mu.Lock()
	syncErr := app.syncError
	app.mu.Unlock()
	lastSync := ""
	if st.LastSyncMs > 0 {
		lastSync = time.UnixMilli(st.LastSyncMs).Format("02/01/2006 15:04")
	}
	dash := st.DashboardURL
	if dash == "" {
		dash = serverURL
	}
	resp := map[string]any{
		"settings":      st.Settings,
		"edition":       appName(),
		"free":          freeEdition,
		"license":       app.license(),
		"storeCode":     storeCode(app.store.storeID()),
		"pairingCode":   pairingCode(st.SyncSecret),
		"tokenSuffix":   suffix,
		"lastSync":      lastSync,
		"syncError":     syncErr,
		"pending":       len(st.Queue),
		"dashboard":     dash,
		"printers":      printers,
		"autostart":     autostartOn(),
		"priceLabel":    priceLabel,
		"vendor":        vendorEmail,
		"version":       appVersion,
		"dataDir":       app.dir,
		"platform":      platformName,
		"pointTerminal": st.PointTerminal,
	}
	if perr != nil {
		resp["printerError"] = perr.Error()
	}
	writeJSON(w, 200, resp)
}

func (app *App) apiSetPin(w http.ResponseWriter, r *http.Request) {
	var in struct{ Pin, Confirm string }
	readJSON(r, &in)
	// Creating the first PIN needs nothing; changing it needs the settings open.
	if app.store.Read().PinHash != "" && !app.adminOK() {
		writeJSON(w, 401, map[string]string{"error": "Configurações bloqueadas. Digite o PIN de novo."})
		return
	}
	if msg := pinProblem(in.Pin, in.Confirm); msg != "" {
		writeJSON(w, 200, map[string]any{"error": msg})
		return
	}
	app.store.Update(func(s *State) {
		s.PinHash = hashPin(in.Pin)
		s.PinFailures, s.LockedUntilMs = 0, 0
	})
	app.mu.Lock()
	app.adminUntil = time.Now().Add(10 * time.Minute)
	app.mu.Unlock()
	writeJSON(w, 200, map[string]any{"ok": true})
}

func newUUID() string {
	b, _ := base64.RawURLEncoding.DecodeString(randomB64(16))
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := func(x []byte) string {
		const digits = "0123456789abcdef"
		out := make([]byte, 0, len(x)*2)
		for _, c := range x {
			out = append(out, digits[c>>4], digits[c&15])
		}
		return string(out)
	}
	return h(b[0:4]) + "-" + h(b[4:6]) + "-" + h(b[6:8]) + "-" + h(b[8:10]) + "-" + h(b[10:16])
}

// ---------------------------------------------------------------- browser

func (app *App) runBrowser(url string) {
	profile := filepath.Join(app.dir, "navegador")
	for {
		app.mu.Lock()
		quitting := app.quitting
		app.mu.Unlock()
		if quitting {
			return
		}
		cmd, err := browserCommand(url, profile)
		if err != nil {
			log.Print(err)
			openDefault(url)
			return
		}
		app.mu.Lock()
		app.browser = cmd
		app.mu.Unlock()
		started := time.Now()
		if err := cmd.Run(); err != nil {
			log.Print("navegador: ", err)
		}
		// Closed (Alt+F4, crash): open again, unless staff chose to close imprime.ai.
		if time.Since(started) < 5*time.Second {
			time.Sleep(5 * time.Second)
		}
	}
}

func (app *App) quit() {
	app.mu.Lock()
	app.quitting = true
	b := app.browser
	app.mu.Unlock()
	app.closeUpload()
	app.clearItems()
	if b != nil && b.Process != nil {
		b.Process.Kill()
	}
	os.Exit(0)
}

func openDefault(url string) { openDefaultBrowser(url) }
