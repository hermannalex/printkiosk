//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

func dataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	return filepath.Join(base, "Quioco")
}

// ---------------------------------------------------------------- secret at rest: Windows DPAPI

var (
	crypt32       = syscall.NewLazyDLL("crypt32.dll")
	kernel32      = syscall.NewLazyDLL("kernel32.dll")
	procProtect   = crypt32.NewProc("CryptProtectData")
	procUnprotect = crypt32.NewProc("CryptUnprotectData")
	procLocalFree = kernel32.NewProc("LocalFree")
)

type dataBlob struct {
	size uint32
	data *byte
}

func dpapi(proc *syscall.LazyProc, in []byte) ([]byte, error) {
	if len(in) == 0 {
		return nil, errors.New("vazio")
	}
	src := dataBlob{uint32(len(in)), &in[0]}
	var out dataBlob
	r, _, err := proc.Call(uintptr(unsafe.Pointer(&src)), 0, 0, 0, 0, 0x1, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, err
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.data)))
	return append([]byte(nil), unsafe.Slice(out.data, out.size)...), nil
}

// sealSecret encrypts with the Windows account's key: another user or computer can't open it.
func sealSecret(plain []byte) ([]byte, error)  { return dpapi(procProtect, plain) }
func openSecret(sealed []byte) ([]byte, error) { return dpapi(procUnprotect, sealed) }

// ---------------------------------------------------------------- printers

type Printer struct {
	Name    string `json:"Name"`
	Default bool   `json:"Default"`
	Offline bool   `json:"WorkOffline"`
}

func powershell(script string, env ...string) ([]byte, error) {
	cmd := hidden(exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script))
	cmd.Env = append(os.Environ(), env...)
	return cmd.Output()
}

func listPrinters() ([]Printer, error) {
	out, err := powershell("Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline | ConvertTo-Json -Compress")
	if err != nil {
		return nil, errors.New("Não foi possível listar as impressoras do Windows.")
	}
	text := strings.TrimSpace(string(out))
	if text == "" {
		return nil, nil
	}
	if strings.HasPrefix(text, "{") {
		text = "[" + text + "]"
	}
	var list []Printer
	if err := json.Unmarshal([]byte(text), &list); err != nil {
		return nil, errors.New("Resposta inesperada ao listar impressoras.")
	}
	return list, nil
}

// setDefaultPrinter makes the browser's silent printing go to this printer, and stops Windows
// from moving the default to the last printer used.
func setDefaultPrinter(name string) error {
	hidden(exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Windows`, "/v", "LegacyDefaultPrinterMode", "/t", "REG_DWORD", "/d", "1", "/f")).Run()
	_, err := powershell("(New-Object -ComObject WScript.Network).SetDefaultPrinter($env:QUIOCO_PRINTER)", "QUIOCO_PRINTER="+name)
	if err != nil {
		return errors.New("O Windows não aceitou esta impressora como padrão.")
	}
	return nil
}

// ---------------------------------------------------------------- start with Windows

const runKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

func setAutostart(on bool) error {
	if !on {
		hidden(exec.Command("reg", "delete", runKey, "/v", "Quioco", "/f")).Run()
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return hidden(exec.Command("reg", "add", runKey, "/v", "Quioco", "/t", "REG_SZ", "/d", `"`+exe+`"`, "/f")).Run()
}

func autostartOn() bool {
	return hidden(exec.Command("reg", "query", runKey, "/v", "Quioco")).Run() == nil
}

// ---------------------------------------------------------------- browser in kiosk mode

func browserCommand(url, profile string) (*exec.Cmd, error) {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(os.Getenv("ProgramFiles"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(os.Getenv("ProgramFiles"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Google\Chrome\Application\chrome.exe`),
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		args := []string{
			"--kiosk", url, "--kiosk-printing", "--no-first-run", "--no-default-browser-check",
			"--user-data-dir=" + profile, "--disable-pinch", "--overscroll-history-navigation=0",
			"--disable-features=Translate,msEdgeTranslate", "--autoplay-policy=no-user-gesture-required",
		}
		if strings.Contains(strings.ToLower(path), "msedge") {
			args = append(args, "--edge-kiosk-type=fullscreen")
		}
		return exec.Command(path, args...), nil
	}
	return nil, errors.New("Microsoft Edge ou Google Chrome não encontrado")
}
