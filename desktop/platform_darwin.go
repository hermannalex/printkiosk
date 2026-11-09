//go:build darwin

package main

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func hidden(cmd *exec.Cmd) *exec.Cmd { return cmd }

func dataDir() string {
	if d := os.Getenv("QUIOCO_DATA"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "Quioco")
}

// ---------------------------------------------------------------- secret at rest: key in the macOS Keychain

const keychainService = "Quioco"
const keychainAccount = "chave-token"

// keychainKey returns the AES key kept in the login Keychain, creating it the first time.
func keychainKey() ([]byte, error) {
	out, err := exec.Command("security", "find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w").Output()
	if err == nil {
		if key, err := hex.DecodeString(strings.TrimSpace(string(out))); err == nil && len(key) == 32 {
			return key, nil
		}
	}
	key := make([]byte, 32)
	rand.Read(key)
	if err := exec.Command("security", "add-generic-password", "-U", "-s", keychainService, "-a", keychainAccount,
		"-l", "Quioco (token do Mercado Pago)", "-w", hex.EncodeToString(key)).Run(); err != nil {
		return nil, errors.New("Chaves do macOS indisponíveis")
	}
	return key, nil
}

func sealSecret(plain []byte) ([]byte, error) {
	key, err := keychainKey()
	if err != nil {
		return nil, err
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, gcm.NonceSize())
	rand.Read(nonce)
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

func openSecret(sealed []byte) ([]byte, error) {
	key, err := keychainKey()
	if err != nil {
		return nil, err
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("formato")
	}
	return gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
}

// ---------------------------------------------------------------- printers (CUPS)

type Printer struct {
	Name    string `json:"Name"`
	Default bool   `json:"Default"`
	Offline bool   `json:"WorkOffline"`
}

func listPrinters() ([]Printer, error) {
	def := ""
	if out, err := exec.Command("lpstat", "-d").Output(); err == nil {
		if i := strings.LastIndex(string(out), ": "); i >= 0 {
			def = strings.TrimSpace(string(out)[i+2:])
		}
	}
	out, err := exec.Command("lpstat", "-p").Output()
	if err != nil && len(out) == 0 {
		return nil, nil // no printers installed
	}
	var list []Printer
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) >= 3 && (f[0] == "printer" || f[0] == "impressora") {
			name := f[1]
			list = append(list, Printer{Name: name, Default: name == def, Offline: strings.Contains(sc.Text(), "disabled") || strings.Contains(sc.Text(), "desativad")})
		}
	}
	return list, nil
}

func setDefaultPrinter(name string) error {
	if strings.ContainsAny(name, "\x00\n") || name == "" {
		return errors.New("Impressora inválida.")
	}
	if err := exec.Command("lpoptions", "-d", name).Run(); err != nil {
		return errors.New("O macOS não aceitou esta impressora como padrão.")
	}
	return nil
}

// ---------------------------------------------------------------- start at login: LaunchAgent

func launchAgentPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "br.com.somainfo.quioco.plist")
}

func setAutostart(on bool) error {
	path := launchAgentPath()
	if !on {
		os.Remove(path)
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	esc := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(exe)
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>br.com.somainfo.quioco</string>
<key>ProgramArguments</key><array><string>%s</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`, esc)
	os.MkdirAll(filepath.Dir(path), 0o755)
	return os.WriteFile(path, []byte(plist), 0o644)
}

func autostartOn() bool {
	_, err := os.Stat(launchAgentPath())
	return err == nil
}

// ---------------------------------------------------------------- browser in kiosk mode

func browserCommand(url, profile string) (*exec.Cmd, error) {
	home, _ := os.UserHomeDir()
	var candidates []string
	for _, root := range []string{"/Applications", filepath.Join(home, "Applications")} {
		candidates = append(candidates,
			filepath.Join(root, "Google Chrome.app/Contents/MacOS/Google Chrome"),
			filepath.Join(root, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
			filepath.Join(root, "Chromium.app/Contents/MacOS/Chromium"),
			filepath.Join(root, "Brave Browser.app/Contents/MacOS/Brave Browser"),
		)
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		return exec.Command(path,
			"--kiosk", url, "--kiosk-printing", "--no-first-run", "--no-default-browser-check",
			"--user-data-dir="+profile, "--disable-pinch", "--overscroll-history-navigation=0",
			"--disable-features=Translate", "--autoplay-policy=no-user-gesture-required"), nil
	}
	return nil, errors.New("Google Chrome ou Microsoft Edge não encontrado")
}

func openDefaultBrowser(url string) { exec.Command("open", url).Start() }

const platformName = "macOS"
