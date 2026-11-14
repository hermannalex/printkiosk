package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// A payment in progress or done: Pix (QR Code), card on the Point terminal, or a credit voucher.
type payment struct {
	method   string // pix | card | voucher
	ref      string // Mercado Pago payment id, Point order id, or the voucher use reference
	cents    int
	deadline time.Time
	pages    int
	copies   int
	paid     bool
	done     bool
}

func (app *App) putPayment(p *payment) {
	app.mu.Lock()
	if app.payments == nil {
		app.payments = map[string]*payment{}
	}
	app.payments[p.ref] = p
	app.mu.Unlock()
}

func (app *App) findPayment(r *http.Request) *payment {
	id := r.URL.Query().Get("id")
	app.mu.Lock()
	defer app.mu.Unlock()
	return app.payments[id]
}

func (app *App) markPaid(p *payment) {
	app.mu.Lock()
	p.paid = true
	app.mu.Unlock()
}

// apiMethods: which ways to pay this kiosk offers right now.
func (app *App) apiMethods(w http.ResponseWriter, r *http.Request) {
	st := app.store.Read()
	token := app.token()
	pix := strings.Contains(st.Settings.PayerEmail, "@") && token != ""
	writeJSON(w, 200, map[string]any{
		"pix":     pix,
		"card":    token != "" && st.PointTerminal != "",
		"voucher": true,
	})
}

// apiCheckout decides: print now (free), take a payment by the chosen method, or refuse.
func (app *App) apiCheckout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Pages, Copies int
		Method        string
	}
	readJSON(r, &in)
	st := app.store.Read()
	lic := app.license()
	if msg := blockedMessage(lic); msg != "" {
		writeJSON(w, 200, map[string]any{"action": "blocked", "message": msg})
		return
	}
	if in.Pages < 1 || in.Copies < 1 || in.Copies > st.Settings.MaxCopies || app.itemCount() == 0 {
		writeJSON(w, 200, map[string]any{"action": "blocked", "message": "Nada para imprimir."})
		return
	}
	if freeEdition || st.Settings.PricePerPageCents == 0 {
		writeJSON(w, 200, map[string]any{"action": "print"})
		return
	}
	total := in.Pages * in.Copies
	cents := total * st.Settings.PricePerPageCents
	seconds := st.Settings.PaymentTimeoutSeconds
	description := st.Settings.KioskName + " – " + strconv.Itoa(total) + " página(s)"
	token := app.token()

	switch in.Method {
	case "voucher":
		writeJSON(w, 200, map[string]any{"action": "voucher", "amountCents": cents})
	case "card":
		if token == "" || st.PointTerminal == "" {
			writeJSON(w, 200, map[string]any{"action": "blocked", "message": "A maquininha ainda não foi configurada. Peça ajuda a um atendente."})
			return
		}
		id, err := pointCreate(token, st.PointTerminal, cents, seconds, description)
		if err != nil {
			writeJSON(w, 200, map[string]any{"action": "payError", "message": err.Error()})
			return
		}
		app.putPayment(&payment{method: "card", ref: id, cents: cents, deadline: time.Now().Add(time.Duration(seconds) * time.Second), pages: in.Pages, copies: in.Copies})
		writeJSON(w, 200, map[string]any{"action": "card", "id": id, "amountCents": cents, "seconds": seconds})
	default:
		if !strings.Contains(st.Settings.PayerEmail, "@") || token == "" {
			writeJSON(w, 200, map[string]any{"action": "blocked", "message": "O pagamento por Pix ainda não foi configurado. Peça ajuda a um atendente."})
			return
		}
		charge, err := pixCreate(token, cents, description, st.Settings.PayerEmail)
		if err != nil {
			writeJSON(w, 200, map[string]any{"action": "payError", "message": err.Error()})
			return
		}
		id := strconv.FormatInt(charge.ID, 10)
		app.putPayment(&payment{method: "pix", ref: id, cents: cents, deadline: time.Now().Add(time.Duration(seconds) * time.Second), pages: in.Pages, copies: in.Copies})
		q, _ := EncodeQR(charge.QRCode)
		writeJSON(w, 200, map[string]any{
			"action": "pay", "id": id, "svg": q.SVG(), "copyPaste": charge.QRCode,
			"amountCents": cents, "seconds": seconds,
		})
	}
}

func (app *App) apiPayStatus(w http.ResponseWriter, r *http.Request) {
	p := app.findPayment(r)
	if p == nil {
		writeJSON(w, 200, map[string]any{"status": "unknown"})
		return
	}
	token := app.token()
	var status string
	var err error
	if p.method == "card" {
		status, err = pointStatus(token, p.ref)
	} else {
		var s string
		id, _ := strconv.ParseInt(p.ref, 10, 64)
		s, err = pixStatus(token, id)
		switch {
		case s == "approved":
			status = "approved"
		case finalFailure(s):
			status = "failed"
		default:
			status = "pending"
		}
	}
	if err != nil {
		status = "pending" // brief network blip
	}
	switch {
	case status == "approved":
		app.markPaid(p)
	case status == "pending" && time.Now().After(p.deadline):
		if p.method == "card" {
			if pointCancel(token, p.ref) == "approved" {
				app.markPaid(p)
				status = "approved"
				break
			}
		} else {
			id, _ := strconv.ParseInt(p.ref, 10, 64)
			pixCancel(token, id)
		}
		if status != "approved" {
			status = "expired"
		}
	}
	writeJSON(w, 200, map[string]any{"status": status})
}

// apiPayCancel: if they paid just before tapping Cancel, print anyway instead of keeping their money.
func (app *App) apiPayCancel(w http.ResponseWriter, r *http.Request) {
	p := app.findPayment(r)
	if p == nil {
		writeJSON(w, 200, map[string]any{"status": "cancelled"})
		return
	}
	token := app.token()
	if p.method == "card" {
		if pointCancel(token, p.ref) == "approved" {
			app.markPaid(p)
			writeJSON(w, 200, map[string]any{"status": "approved"})
			return
		}
		writeJSON(w, 200, map[string]any{"status": "cancelled"})
		return
	}
	id, _ := strconv.ParseInt(p.ref, 10, 64)
	if s, err := pixStatus(token, id); err == nil && s == "approved" {
		app.markPaid(p)
		writeJSON(w, 200, map[string]any{"status": "approved"})
		return
	}
	pixCancel(token, id)
	writeJSON(w, 200, map[string]any{"status": "cancelled"})
}

func (app *App) apiVoucherRedeem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code          string
		Pages, Copies int
	}
	readJSON(r, &in)
	st := app.store.Read()
	if msg := blockedMessage(app.license()); msg != "" {
		writeJSON(w, 200, map[string]any{"error": msg})
		return
	}
	if in.Pages < 1 || in.Copies < 1 || in.Copies > st.Settings.MaxCopies {
		writeJSON(w, 200, map[string]any{"error": "Nada para imprimir."})
		return
	}
	cents := in.Pages * in.Copies * st.Settings.PricePerPageCents
	ref := newUUID()
	out, err := app.voucherCall(map[string]any{"action": "redeem", "code": in.Code, "amountCents": cents, "ref": ref})
	if err != nil {
		writeJSON(w, 200, map[string]any{"error": err.Error()})
		return
	}
	p := &payment{method: "voucher", ref: ref, cents: cents, pages: in.Pages, copies: in.Copies, paid: true}
	app.putPayment(p)
	balance, _ := out["balanceCents"].(float64)
	writeJSON(w, 200, map[string]any{"status": "approved", "id": ref, "balanceCents": int(balance)})
}

func (app *App) apiPrintDone(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Success   bool
		Items     int
		Pages     int
		Copies    int
		PaymentID string
	}
	readJSON(r, &in)
	var paidID *string
	method := ""
	amount := 0
	app.mu.Lock()
	p := app.payments[in.PaymentID]
	if p != nil && p.paid && !p.done && in.Success {
		p.done = true
		s := p.ref
		paidID, method, amount = &s, p.method, p.cents
	}
	app.mu.Unlock()
	// A voucher that paid for a print that failed gets its value back.
	if p != nil && p.method == "voucher" && !in.Success {
		go app.voucherCall(map[string]any{"action": "refund", "ref": p.ref})
		app.mu.Lock()
		p.done = true
		app.mu.Unlock()
	}
	demo := !freeEdition && app.license().State != "active"
	if demo && in.Success {
		app.store.Update(func(s *State) { s.DemoUsed++ })
	}
	job := PrintJob{
		ID: newUUID(), PrintedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Items: in.Items, Pages: in.Pages, Copies: in.Copies, TotalPages: in.Pages * in.Copies,
		AmountCents: amount, PaidWithPix: method == "pix", Success: in.Success, Demo: demo,
		PaymentMethod: method, PaymentID: paidID,
	}
	if method == "pix" {
		job.PixPaymentID = paidID
	}
	app.recordJob(job)
	writeJSON(w, 200, map[string]any{"ok": true})
}
