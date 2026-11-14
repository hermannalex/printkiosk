package main

import (
	"testing"
	"time"
)

// Same values as the server (web/tests/license.test.ts) and the Android/iOS apps.
func TestPairingCodeMatchesOtherApps(t *testing.T) {
	if got := pairingCode("teste-claude-0123456789"); got != "MBD-4D6" {
		t.Fatalf("pairing code %s", got)
	}
}

func TestStoreCodeAndDays(t *testing.T) {
	if got := storeCode([]byte{0, 0, 0, 0, 0}); got != "AAAA-AAAA" {
		t.Fatal(got)
	}
	if dayNumber(time.Date(2024, 1, 2, 15, 0, 0, 0, time.Local)) != 1 {
		t.Fatal("day number")
	}
	if verifyLicense("PK1-AAAA", []byte{1, 2, 3, 4, 5}) != -1 {
		t.Fatal("bad code accepted")
	}
}

func TestPinRules(t *testing.T) {
	for _, bad := range []string{"123456", "111111", "654321", "12345", "abcdef"} {
		if pinProblem(bad, bad) == "" {
			t.Fatal("accepted", bad)
		}
	}
	if pinProblem("482913", "482913") != "" || pinProblem("482913", "482914") == "" {
		t.Fatal("pin rules")
	}
}

func TestRemoteSettingsLimits(t *testing.T) {
	s := applyRemote(defaultSettings(), map[string]any{"pricePerPageCents": 75.0, "maxCopies": 99.0, "idleTimeoutSeconds": 45.0, "kioskName": " Loja "})
	if s.PricePerPageCents != 75 || s.MaxCopies != 10 || s.IdleTimeoutSeconds != 90 || s.KioskName != "Loja" {
		t.Fatalf("%+v", s)
	}
}

func TestWifiPayload(t *testing.T) {
	if wifiPayload("Loja;1", "a:b") != `WIFI:T:WPA;S:Loja\;1;P:a\:b;;` {
		t.Fatal(wifiPayload("Loja;1", "a:b"))
	}
}

func TestTrialEndsInWatermarkNotBlock(t *testing.T) {
	if demoPrints != 10 {
		t.Fatalf("free trial should be 10 prints, got %d", demoPrints)
	}
	for state, want := range map[string]bool{"active": false, "demo": false, "demoOver": true, "expired": true} {
		lic := License{State: state}
		if got := watermarked(lic); got != want {
			t.Errorf("watermarked(%s) = %v, want %v", state, got, want)
		}
		if msg := blockedMessage(lic); msg != "" {
			t.Errorf("state %s should not block printing, got %q", state, msg)
		}
	}
}

func TestFreeEditionNeverCharges(t *testing.T) {
	if !freeEdition {
		t.Skip("only in the imprime-free build (go test -tags free)")
	}
	if appName() != "imprime-free" || dataDirName() != "imprime-free" || uiPort == "47800" {
		t.Fatalf("imprime-free must use its own name, folder and port")
	}
	if freeAdQR() == "" {
		t.Fatal("ad QR Code missing")
	}
}
