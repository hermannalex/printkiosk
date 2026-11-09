package main

import (
	"os"
	"strings"
	"unicode/utf8"
)

func trim(s string) string { return strings.TrimSpace(s) }

func containsRune(s string, r rune) bool { return strings.ContainsRune(s, r) }

func validUTF8(s string) bool { return utf8.ValidString(s) }

// wifiPayload is the text phone cameras read to join a network.
func wifiPayload(name, password string) string {
	esc := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, ":", `\:`, `"`, `\"`)
	if password == "" {
		return "WIFI:T:nopass;S:" + esc.Replace(name) + ";;"
	}
	return "WIFI:T:WPA;S:" + esc.Replace(name) + ";P:" + esc.Replace(password) + ";;"
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
