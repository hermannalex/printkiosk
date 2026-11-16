package main

import (
	"fmt"
	"time"
)

// The same source builds two apps:
//   - imprime.ai (default): payments, license, dashboard sync.
//   - imprime-free (`go build -tags free`): prints for free (up to freeDailyCopies a day), no payments, no license
//     and no dashboard, and shows ads for imprime.ai. It keeps its own data folder and port, so both
//     can be installed on the same computer.

var freeEdition = false

// Where the imprime-free ads send people (the QR Code on screen).
const freeAdURL = "https://imprime.ai/?origem=imprime-free"

var uiPort = "47800"

func appName() string {
	if freeEdition {
		return "imprime-free"
	}
	return "imprime.ai"
}

// dataDirName keeps the original folder name for imprime.ai so existing kiosks keep their settings.
func dataDirName() string {
	if freeEdition {
		return "imprime-free"
	}
	return "Quioco"
}

var adQR string

// freeAdQR is the SVG of the QR Code that points to imprime.ai (built once).
func freeAdQR() string {
	if adQR == "" {
		if q, err := EncodeQR(freeAdURL); err == nil {
			adQR = q.SVG()
		}
	}
	return adQR
}

// imprime-free prints up to this many copies (pages x copies) a day; imprime.ai has no such limit.
const freeDailyCopies = 20

func today() string { return time.Now().Format("2006-01-02") }

// freeLeft is how many copies imprime-free may still print today.
func freeLeft(s State) int {
	used := 0
	if s.FreeDay == today() {
		used = s.FreeUsed
	}
	return max(0, freeDailyCopies-used)
}

// countFreeCopies adds printed copies to today's imprime-free count.
func countFreeCopies(s *State, n int) {
	if s.FreeDay != today() {
		s.FreeDay, s.FreeUsed = today(), 0
	}
	s.FreeUsed += n
}

func freeLimitMessage() string {
	return fmt.Sprintf("O limite de %d cópias grátis de hoje acabou. Volte amanhã! Para imprimir sem limite, conheça o imprime.ai.", freeDailyCopies)
}
