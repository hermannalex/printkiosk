package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// Credit vouchers made in the dashboard (Painel › Vouchers): the kiosk asks the server to take
// the amount from the code, once per reference, and to give it back if printing fails.
func (app *App) voucherCall(body map[string]any) (map[string]any, error) {
	st := app.store.Read()
	body["storeCode"] = storeCode(app.store.storeID())
	body["secret"] = st.SyncSecret
	data, _ := json.Marshal(body)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(serverURL+"/api/kiosk/voucher", "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("Sem conexão com o painel. Verifique a internet e tente de novo.")
	}
	defer resp.Body.Close()
	var out map[string]any
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out) != nil {
		return nil, errors.New("Resposta inesperada do painel. Tente de novo.")
	}
	if ok, _ := out["ok"].(bool); !ok {
		msg, _ := out["error"].(string)
		if msg == "" {
			msg = "Não foi possível usar o voucher."
		}
		return out, errors.New(msg)
	}
	return out, nil
}
