package main

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

// Staff PIN, as in AdminLock.kt: 6–12 digits, no trivial sequences, PBKDF2-SHA256 120k,
// 5 free tries then a lock of 1 minute doubling up to 1 hour, kept across restarts.
const pinMin = 6

func pinTrivial(pin string) bool {
	if len(pin) < 2 {
		return true
	}
	steps := map[int]bool{}
	for i := 1; i < len(pin); i++ {
		steps[int(pin[i])-int(pin[i-1])] = true
	}
	return len(steps) == 1 && (steps[0] || steps[1] || steps[-1])
}

func pinProblem(pin, confirm string) string {
	ok := len(pin) >= pinMin && len(pin) <= 12 && strings.Trim(pin, "0123456789") == "" && !pinTrivial(pin)
	if !ok {
		return fmt.Sprintf("Use de %d a 12 números, sem repetir o mesmo número nem fazer sequências.", pinMin)
	}
	if pin != confirm {
		return "Os dois PINs não são iguais."
	}
	return ""
}

func derivePin(pin string, salt []byte) []byte {
	key, _ := pbkdf2.Key(sha256.New, pin, salt, 120_000, 32)
	return key
}

func hashPin(pin string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	return base64.StdEncoding.EncodeToString(salt) + ":" + base64.StdEncoding.EncodeToString(derivePin(pin, salt))
}

func lockDuration(seconds int) string {
	if seconds < 60 {
		return fmt.Sprintf("%d segundos", seconds)
	}
	return fmt.Sprintf("%d minuto(s)", (seconds+59)/60)
}

// checkPin returns "" when right, or the message to show.
func (app *App) checkPin(pin string) string {
	var msg string
	app.store.Update(func(s *State) {
		now := time.Now().UnixMilli()
		if s.LockedUntilMs > now {
			msg = "Muitas tentativas erradas. Tente de novo em " + lockDuration(int((s.LockedUntilMs-now+999)/1000)) + "."
			return
		}
		parts := strings.Split(s.PinHash, ":")
		if len(parts) == 2 {
			salt, _ := base64.StdEncoding.DecodeString(parts[0])
			want, _ := base64.StdEncoding.DecodeString(parts[1])
			if hmac.Equal(derivePin(pin, salt), want) {
				s.PinFailures, s.LockedUntilMs = 0, 0
				return
			}
		}
		s.PinFailures++
		if s.PinFailures < 5 {
			msg = fmt.Sprintf("PIN incorreto. %d tentativa(s) restante(s).", 5-s.PinFailures)
			return
		}
		seconds := min(3600, 60*(1<<min(s.PinFailures-5, 6)))
		s.LockedUntilMs = now + int64(seconds)*1000
		msg = "Muitas tentativas erradas. Tente de novo em " + lockDuration(seconds) + "."
	})
	return msg
}
