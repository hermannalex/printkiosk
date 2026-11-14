package main

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"
)

// Monthly activation codes, the same as LicenseCodec.kt / License.swift:
// "PK1-" + base64url(payload + ECDSA P-256 signature), payload = version(1) + store ID(5) + last day(2).
const (
	demoPrints     = 10
	priceLabel     = "a partir de R$ 19,99/mês"
	vendorEmail    = "alex@somainfo.com.br"
	licensePubKey  = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvKAdZ2rVE+ExL+GWj0OJcDS05O4NnOBt8hAXeUANqC/aX1J2RW9cpXoDr78Xag57U0tm1Vo2oO90bSO95fiYYw=="
	base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
)

// serverURL is the dashboard; QUIOCO_SERVER overrides it only in tests.
var serverURL = envOr("QUIOCO_SERVER", "https://quioco.vercel.app")

var licenseEpoch = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

func storeCode(id []byte) string {
	var bits uint64
	for _, b := range id {
		bits = bits<<8 | uint64(b)
	}
	var out []byte
	for i := 7; i >= 0; i-- {
		out = append(out, base32Alphabet[(bits>>(uint(i)*5))&31])
	}
	return string(out[:4]) + "-" + string(out[4:])
}

func dayNumber(t time.Time) int {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return int(d.Sub(licenseEpoch).Hours() / 24)
}

func dayDate(n int) time.Time { return licenseEpoch.AddDate(0, 0, n) }

// verifyLicense returns the last valid day number, or -1 when the code is not valid for this store.
func verifyLicense(code string, id []byte) int {
	cleaned := strings.Join(strings.Fields(code), "")
	cleaned = strings.TrimPrefix(strings.TrimPrefix(cleaned, "PK1-"), "pk1-")
	data, err := base64.URLEncoding.DecodeString(padB64(cleaned))
	if err != nil || len(data) <= 8 {
		return -1
	}
	payload, sig := data[:8], data[8:]
	if payload[0] != 1 || string(payload[1:6]) != string(id) {
		return -1
	}
	der, _ := base64.StdEncoding.DecodeString(licensePubKey)
	parsed, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return -1
	}
	key, ok := parsed.(*ecdsa.PublicKey)
	if !ok {
		return -1
	}
	digest := sha256.Sum256(payload)
	if !ecdsa.VerifyASN1(key, digest[:], sig) {
		return -1
	}
	return int(payload[6])<<8 | int(payload[7])
}

func padB64(s string) string {
	for len(s)%4 != 0 {
		s += "="
	}
	return s
}

// pairingCode: base32(sha256("pair:" + sha256hex(secret))), 6 chars, as in web/lib/license.ts.
func pairingCode(secret string) string {
	h := sha256.Sum256([]byte(secret))
	d := sha256.Sum256([]byte("pair:" + hex.EncodeToString(h[:])))
	var bits uint64
	for i := 0; i < 5; i++ {
		bits = bits<<8 | uint64(d[i])
	}
	var out []byte
	for i := 7; i >= 0; i-- {
		out = append(out, base32Alphabet[(bits>>(uint(i)*5))&31])
	}
	return string(out[:3]) + "-" + string(out[3:6])
}

type License struct {
	State     string `json:"state"` // active, expired, demo, demoOver
	Until     string `json:"until,omitempty"`
	Remaining int    `json:"remaining"`
}

func (app *App) license() License {
	var lic License
	if freeEdition {
		return License{State: "free"}
	}
	app.store.Update(func(s *State) {
		real := dayNumber(time.Now())
		if s.MaxDay < real {
			s.MaxDay = real
		}
		today := s.MaxDay // turning the clock back doesn't help
		id, _ := base64.StdEncoding.DecodeString(s.StoreID)
		if s.LicenseCode != "" {
			if until := verifyLicense(s.LicenseCode, id); until >= 0 {
				lic.Until = dayDate(until).Format("2006-01-02")
				if today <= until {
					lic.State = "active"
				} else {
					lic.State = "expired"
				}
				return
			}
		}
		lic.Remaining = max(0, demoPrints-s.DemoUsed)
		if lic.Remaining > 0 {
			lic.State = "demo"
		} else {
			lic.State = "demoOver"
		}
	})
	return lic
}
