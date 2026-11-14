package main

// The same source builds two apps:
//   - imprime.ai (default): payments, license, dashboard sync.
//   - imprime-free (`go build -tags free`): prints for free with no limit, no payments, no license
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
