//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

// Development build for Linux/macOS: same app, without the Windows-only parts.

func hidden(cmd *exec.Cmd) *exec.Cmd { return cmd }

func dataDir() string {
	if d := os.Getenv("QUIOCO_DATA"); d != "" {
		return d
	}
	base, _ := os.UserConfigDir()
	return filepath.Join(base, "Quioco")
}

func sealSecret(plain []byte) ([]byte, error) { return append([]byte("dev:"), plain...), nil }
func openSecret(sealed []byte) ([]byte, error) {
	if len(sealed) < 4 || string(sealed[:4]) != "dev:" {
		return nil, errors.New("formato")
	}
	return sealed[4:], nil
}

type Printer struct {
	Name    string `json:"Name"`
	Default bool   `json:"Default"`
	Offline bool   `json:"WorkOffline"`
}

func listPrinters() ([]Printer, error) {
	return []Printer{{Name: "Impressora de teste", Default: true}}, nil
}
func setDefaultPrinter(name string) error { return nil }
func setAutostart(on bool) error          { return nil }
func autostartOn() bool                   { return false }

func browserCommand(url, profile string) (*exec.Cmd, error) {
	return nil, errors.New("abra " + url + " no navegador")
}
