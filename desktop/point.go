package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Mercado Pago Point (Point Smart 1/2, Point Pro 2) through the Orders API: the kiosk sends the
// amount to the store's card terminal, and the customer pays there with a chip card, a contactless
// card, Apple Pay or Google Pay. Docs: mercadopago.com.br/developers › Point › Orders API.

type PointTerminal struct {
	ID            string `json:"id"`
	OperatingMode string `json:"operating_mode"`
}

func pointCall(token, method, path string, body any, headers map[string]string) (map[string]any, int, error) {
	if token == "" {
		return nil, 0, errors.New("Salve o Access Token do Mercado Pago primeiro.")
	}
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, mpAPI+path, reader)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, errors.New(networkError)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out)
	if resp.StatusCode >= 300 {
		msg, _ := out["message"].(string)
		if msg == "" {
			if errs, ok := out["errors"].([]any); ok && len(errs) > 0 {
				if e, ok := errs[0].(map[string]any); ok {
					msg, _ = e["message"].(string)
				}
			}
		}
		if msg == "" {
			msg = fmt.Sprintf("erro HTTP %d", resp.StatusCode)
		}
		return out, resp.StatusCode, errors.New("O Mercado Pago recusou: " + msg)
	}
	return out, resp.StatusCode, nil
}

func pointTerminals(token string) ([]PointTerminal, error) {
	out, _, err := pointCall(token, "GET", "terminals/v1/list?limit=50", nil, nil)
	if err != nil {
		return nil, err
	}
	var list []PointTerminal
	if data, ok := out["data"].(map[string]any); ok {
		if ts, ok := data["terminals"].([]any); ok {
			for _, t := range ts {
				if m, ok := t.(map[string]any); ok {
					id, _ := m["id"].(string)
					mode, _ := m["operating_mode"].(string)
					if id != "" {
						list = append(list, PointTerminal{ID: id, OperatingMode: mode})
					}
				}
			}
		}
	}
	if len(list) == 0 {
		return nil, errors.New("Nenhuma maquininha Point encontrada nesta conta do Mercado Pago. Vincule a Point no app do Mercado Pago e tente de novo.")
	}
	return list, nil
}

// pointSetPDV puts the terminal in the mode where it waits for amounts sent by a system.
func pointSetPDV(token, id string) error {
	body := map[string]any{"terminals": []map[string]string{{"id": id, "operating_mode": "PDV"}}}
	_, _, err := pointCall(token, "PATCH", "terminals/v1/setup", body, nil)
	return err
}

func isoDuration(seconds int) string {
	if seconds%60 == 0 {
		return fmt.Sprintf("PT%dM", seconds/60)
	}
	return fmt.Sprintf("PT%dS", seconds)
}

// pointCreate sends the amount to the terminal; returns the order id.
func pointCreate(token, terminal string, cents, seconds int, description string) (string, error) {
	body := map[string]any{
		"type":               "point",
		"external_reference": "quioco-" + strings.ReplaceAll(newUUID(), "-", "")[:20],
		"expiration_time":    isoDuration(max(30, seconds)),
		"description":        clampText(description, 150),
		"transactions":       map[string]any{"payments": []map[string]string{{"amount": fmt.Sprintf("%d.%02d", cents/100, cents%100)}}},
		"config":             map[string]any{"point": map[string]string{"terminal_id": terminal, "print_on_terminal": "no_ticket"}},
	}
	out, _, err := pointCall(token, "POST", "v1/orders", body, map[string]string{"X-Idempotency-Key": newUUID()})
	if err != nil {
		return "", err
	}
	id, _ := out["id"].(string)
	if id == "" {
		return "", errors.New("O Mercado Pago enviou uma resposta inesperada. Tente de novo.")
	}
	return id, nil
}

// pointStatus maps the order to approved, failed or pending.
func pointStatus(token, id string) (string, error) {
	out, _, err := pointCall(token, "GET", "v1/orders/"+id, nil, nil)
	if err != nil {
		return "", err
	}
	return mapPointStatus(out), nil
}

func mapPointStatus(order map[string]any) string {
	switch s, _ := order["status"].(string); s {
	case "processed":
		return "approved"
	case "failed", "canceled", "expired", "refunded":
		return "failed"
	default: // created, at_terminal, action_required
		return "pending"
	}
}

// pointCancel stops the order on the terminal; returns "approved" if it was paid meanwhile.
func pointCancel(token, id string) string {
	out, _, err := pointCall(token, "POST", "v1/orders/"+id+"/cancel", nil,
		map[string]string{"X-Idempotency-Key": newUUID(), "x-allow-cancelable-status": "at_terminal"})
	if err == nil && mapPointStatus(out) == "approved" {
		return "approved"
	}
	if s, err := pointStatus(token, id); err == nil && s == "approved" {
		return "approved"
	}
	return "cancelled"
}
