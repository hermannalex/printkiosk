package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// Dashboard sync, the same protocol as CloudSync.kt / CloudSync.swift.
type syncResult struct {
	ok            bool
	err           string
	activation    string
	config        map[string]any
	configVersion int
}

func (app *App) syncOnce() *syncResult {
	app.syncMu.Lock()
	defer app.syncMu.Unlock()
	st := app.store.Read()
	lic := app.license()
	pending := st.Queue
	if len(pending) > 200 {
		pending = pending[:200]
	}
	var demo any
	switch lic.State {
	case "demo":
		demo = lic.Remaining
	case "demoOver":
		demo = 0
	}
	cfg := st.Settings
	body := map[string]any{
		"storeCode":     storeCode(app.store.storeID()),
		"secret":        st.SyncSecret,
		"platform":      platformName,
		"appVersion":    appVersion,
		"licenseState":  lic.State,
		"demoRemaining": demo,
		"config":        cfg,
		"configVersion": st.AppliedConfigVersion,
		"jobs":          append([]PrintJob{}, pending...),
	}
	data, _ := json.Marshal(body)
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Post(serverURL+"/api/kiosk/sync", "application/json", bytes.NewReader(data))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var out map[string]any
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out) != nil {
		return nil
	}
	if resp.StatusCode != 200 {
		msg, _ := out["error"].(string)
		if msg == "" {
			msg = resp.Status
		}
		return &syncResult{err: msg}
	}
	sent := map[string]bool{}
	for _, j := range pending {
		sent[j.ID] = true
	}
	dash, _ := out["dashboardUrl"].(string)
	app.store.Update(func(s *State) {
		var keep []PrintJob
		for _, j := range s.Queue {
			if !sent[j.ID] {
				keep = append(keep, j)
			}
		}
		s.Queue = keep
		s.LastSyncMs = time.Now().UnixMilli()
		if dash != "" {
			s.DashboardURL = dash
		}
	})
	r := &syncResult{ok: true}
	r.activation, _ = out["activationCode"].(string)
	r.config, _ = out["config"].(map[string]any)
	if v, ok := out["configVersion"].(float64); ok {
		r.configVersion = int(v)
	}
	return r
}

// Sync sends prints, applies newer dashboard settings and a newer activation code.
func (app *App) Sync() {
	if freeEdition {
		return // imprime-free has no dashboard
	}
	r := app.syncOnce()
	if r == nil {
		return
	}
	app.mu.Lock()
	app.syncError = r.err
	app.mu.Unlock()
	if !r.ok {
		return
	}
	changed := false
	if r.config != nil {
		app.store.Update(func(s *State) {
			if r.configVersion > s.AppliedConfigVersion {
				s.Settings = applyRemote(s.Settings, r.config)
				s.AppliedConfigVersion = r.configVersion
				changed = true
			}
		})
	}
	if r.activation != "" {
		id := app.store.storeID()
		if until := verifyLicense(r.activation, id); until >= 0 {
			current := -1
			if lic := app.license(); lic.State == "active" {
				t, _ := time.Parse("2006-01-02", lic.Until)
				current = dayNumber(t)
			}
			if until > current {
				app.store.Update(func(s *State) { s.LicenseCode = r.activation })
			}
		}
	}
	if changed {
		app.syncOnce() // tell the dashboard the new settings are in use
	}
}

func (app *App) syncLoop() {
	if freeEdition {
		return
	}
	for {
		app.Sync()
		time.Sleep(30 * time.Minute)
	}
}

func (app *App) recordJob(job PrintJob) {
	app.store.Update(func(s *State) {
		s.Queue = append(s.Queue, job)
		if len(s.Queue) > 2000 {
			s.Queue = s.Queue[len(s.Queue)-2000:]
		}
	})
	go app.Sync()
}
