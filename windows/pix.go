package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Mercado Pago Payments API for Pix, as in PixService.kt.
var mpAPI = envOr("QUIOCO_MP_API", "https://api.mercadopago.com/") // override only in tests
const networkError = "Sem conexão com o Mercado Pago. Verifique a internet do computador e tente de novo."

var httpClient = &http.Client{Timeout: 20 * time.Second}

func mpSend(token, method, path string, body any, idempotency string) (map[string]any, error) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, mpAPI+path, reader)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	if idempotency != "" {
		req.Header.Set("X-Idempotency-Key", idempotency)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errors.New(networkError)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out)
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return out, nil
	case resp.StatusCode == 401 || resp.StatusCode == 403:
		return nil, errors.New("O Mercado Pago recusou o token de acesso. Confira o token nas configurações.")
	default:
		msg, _ := out["message"].(string)
		if msg == "" {
			msg = fmt.Sprintf("erro HTTP %d", resp.StatusCode)
		}
		return nil, errors.New("O Mercado Pago recusou a cobrança: " + msg)
	}
}

type PixCharge struct {
	ID          int64  `json:"id"`
	QRCode      string `json:"qrCode"`
	AmountCents int    `json:"amountCents"`
}

func pixCreate(token string, cents int, description, payer string) (PixCharge, error) {
	// Mercado Pago requires at least 30 minutes; the kiosk cancels much sooner if nobody pays.
	exp := time.Now().Add(30 * time.Minute).Format("2006-01-02T15:04:05.000-07:00")
	body := map[string]any{
		"transaction_amount": json.Number(fmt.Sprintf("%d.%02d", cents/100, cents%100)),
		"description":        description,
		"payment_method_id":  "pix",
		"payer":              map[string]string{"email": payer},
		"date_of_expiration": exp,
	}
	out, err := mpSend(token, "POST", "v1/payments", body, randomB64(16))
	if err != nil {
		return PixCharge{}, err
	}
	id, _ := out["id"].(float64)
	var qr string
	if poi, ok := out["point_of_interaction"].(map[string]any); ok {
		if td, ok := poi["transaction_data"].(map[string]any); ok {
			qr, _ = td["qr_code"].(string)
		}
	}
	if id <= 0 || qr == "" {
		return PixCharge{}, errors.New("O Mercado Pago enviou uma resposta inesperada. Tente de novo.")
	}
	return PixCharge{ID: int64(id), QRCode: qr, AmountCents: cents}, nil
}

func pixStatus(token string, id int64) (string, error) {
	out, err := mpSend(token, "GET", fmt.Sprintf("v1/payments/%d", id), nil, "")
	if err != nil {
		return "", err
	}
	s, _ := out["status"].(string)
	return s, nil
}

func pixCancel(token string, id int64) {
	_, _ = mpSend(token, "PUT", fmt.Sprintf("v1/payments/%d", id), map[string]string{"status": "cancelled"}, "")
}

func mpAccountName(token string) (string, error) {
	out, err := mpSend(token, "GET", "users/me", nil, "")
	if err != nil {
		return "", err
	}
	for _, k := range []string{"nickname", "email"} {
		if v, _ := out[k].(string); v != "" {
			return v, nil
		}
	}
	return "Mercado Pago", nil
}

func finalFailure(status string) bool {
	return status == "rejected" || status == "cancelled" || status == "refunded" || status == "charged_back"
}
