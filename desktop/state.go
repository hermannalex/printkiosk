package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Settings mirror KioskSettings in the iOS and Android apps (and web/lib/kiosk-config.ts).
type Settings struct {
	KioskName             string `json:"kioskName"`
	IdleTimeoutSeconds    int    `json:"idleTimeoutSeconds"`
	MaxCopies             int    `json:"maxCopies"`
	MaxItems              int    `json:"maxItems"`
	PricePerPageCents     int    `json:"pricePerPageCents"`
	PayerEmail            string `json:"payerEmail"`
	PaymentTimeoutSeconds int    `json:"paymentTimeoutSeconds"`
	WifiName              string `json:"wifiName"`
	WifiPassword          string `json:"wifiPassword"`
}

func defaultSettings() Settings {
	return Settings{KioskName: "Estação de Impressão", IdleTimeoutSeconds: 90, MaxCopies: 10, MaxItems: 20, PaymentTimeoutSeconds: 300}
}

// PrintJob is one finished print, as reported to the dashboard.
type PrintJob struct {
	ID           string  `json:"id"`
	PrintedAt    string  `json:"printedAt"`
	Items        int     `json:"items"`
	Pages        int     `json:"pages"`
	Copies       int     `json:"copies"`
	TotalPages   int     `json:"totalPages"`
	AmountCents  int     `json:"amountCents"`
	PaidWithPix  bool    `json:"paidWithPix"`
	PixPaymentID *string `json:"pixPaymentId"`
	Success      bool    `json:"success"`
	Demo         bool    `json:"demo"`
}

// State is everything the kiosk keeps, in %LOCALAPPDATA%\Quioco\state.json.
type State struct {
	Settings             Settings   `json:"settings"`
	StoreID              string     `json:"storeId"`
	LicenseCode          string     `json:"licenseCode,omitempty"`
	DemoUsed             int        `json:"demoUsed"`
	MaxDay               int        `json:"maxDay"`
	SyncSecret           string     `json:"syncSecret"`
	Queue                []PrintJob `json:"queue"`
	LastSyncMs           int64      `json:"lastSyncMs"`
	DashboardURL         string     `json:"dashboardUrl,omitempty"`
	AppliedConfigVersion int        `json:"appliedConfigVersion"`
	PinHash              string     `json:"pinHash,omitempty"`
	PinFailures          int        `json:"pinFailures"`
	LockedUntilMs        int64      `json:"lockedUntilMs"`
	SealedToken          string     `json:"sealedToken,omitempty"`
	Printer              string     `json:"printer,omitempty"`
}

type Store struct {
	mu   sync.Mutex
	dir  string
	path string
	s    State
}

func randomB64(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	st := &Store{dir: dir, path: filepath.Join(dir, "state.json"), s: State{Settings: defaultSettings()}}
	if data, err := os.ReadFile(st.path); err == nil {
		_ = json.Unmarshal(data, &st.s)
	}
	if id, err := base64.StdEncoding.DecodeString(st.s.StoreID); err != nil || len(id) != 5 {
		b := make([]byte, 5)
		rand.Read(b)
		st.s.StoreID = base64.StdEncoding.EncodeToString(b)
	}
	if len(st.s.SyncSecret) < 16 {
		st.s.SyncSecret = randomB64(24)
	}
	st.s.Settings = sanitizeSettings(st.s.Settings)
	return st, st.saveLocked()
}

// Update runs fn with the lock held and saves the result.
func (st *Store) Update(fn func(s *State)) {
	st.mu.Lock()
	defer st.mu.Unlock()
	fn(&st.s)
	_ = st.saveLocked()
}

func (st *Store) Read() State {
	st.mu.Lock()
	defer st.mu.Unlock()
	copy := st.s
	copy.Queue = append([]PrintJob(nil), st.s.Queue...)
	return copy
}

func (st *Store) saveLocked() error {
	data, err := json.MarshalIndent(st.s, "", "  ")
	if err != nil {
		return err
	}
	tmp := st.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, st.path)
}

func (st *Store) storeID() []byte {
	b, _ := base64.StdEncoding.DecodeString(st.Read().StoreID)
	return b
}

var idleOptions = []int{30, 60, 90, 120, 300}
var paymentOptions = []int{120, 180, 300, 600}

func contains(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func clampText(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		r = r[:n]
	}
	return string(r)
}

// sanitizeSettings keeps every value within the same limits as the other apps' settings screens.
func sanitizeSettings(s Settings) Settings {
	d := defaultSettings()
	if s.KioskName = clampText(trim(s.KioskName), 40); s.KioskName == "" {
		s.KioskName = d.KioskName
	}
	if s.PricePerPageCents < 0 || s.PricePerPageCents > 5000 {
		s.PricePerPageCents = d.PricePerPageCents
	}
	if s.MaxCopies < 1 || s.MaxCopies > 50 {
		s.MaxCopies = d.MaxCopies
	}
	if s.MaxItems < 1 || s.MaxItems > 50 {
		s.MaxItems = d.MaxItems
	}
	if !contains(idleOptions, s.IdleTimeoutSeconds) {
		s.IdleTimeoutSeconds = d.IdleTimeoutSeconds
	}
	if !contains(paymentOptions, s.PaymentTimeoutSeconds) {
		s.PaymentTimeoutSeconds = d.PaymentTimeoutSeconds
	}
	s.PayerEmail = clampText(trim(s.PayerEmail), 254)
	s.WifiName = clampText(s.WifiName, 32)
	s.WifiPassword = clampText(s.WifiPassword, 63)
	return s
}

// applyRemote takes each value from the dashboard that passes the same limits.
func applyRemote(s Settings, remote map[string]any) Settings {
	num := func(key string) (int, bool) {
		v, ok := remote[key].(float64)
		return int(v), ok && v == float64(int(v))
	}
	str := func(key string) (string, bool) {
		v, ok := remote[key].(string)
		return v, ok
	}
	if v, ok := str("kioskName"); ok && trim(v) != "" {
		s.KioskName = clampText(trim(v), 40)
	}
	if v, ok := num("pricePerPageCents"); ok && v >= 0 && v <= 5000 {
		s.PricePerPageCents = v
	}
	if v, ok := num("maxCopies"); ok && v >= 1 && v <= 50 {
		s.MaxCopies = v
	}
	if v, ok := num("maxItems"); ok && v >= 1 && v <= 50 {
		s.MaxItems = v
	}
	if v, ok := num("idleTimeoutSeconds"); ok && contains(idleOptions, v) {
		s.IdleTimeoutSeconds = v
	}
	if v, ok := num("paymentTimeoutSeconds"); ok && contains(paymentOptions, v) {
		s.PaymentTimeoutSeconds = v
	}
	if v, ok := str("payerEmail"); ok && (v == "" || containsRune(v, '@')) {
		s.PayerEmail = clampText(v, 254)
	}
	if v, ok := str("wifiName"); ok {
		s.WifiName = clampText(v, 32)
	}
	if v, ok := str("wifiPassword"); ok {
		s.WifiPassword = clampText(v, 63)
	}
	return s
}
