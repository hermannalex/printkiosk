#!/usr/bin/env python3
"""
Gera o código de ativação mensal do PrintKiosk para uma loja.

Uso:
    python3 gerar-codigo.py ABCD-EFGH                 # vale por 31 dias a partir de hoje
    python3 gerar-codigo.py ABCD-EFGH --ate 2026-12-31
    python3 gerar-codigo.py ABCD-EFGH --dias 62

ABCD-EFGH é o "Código da loja" que aparece em Configurações › Assinatura no aparelho.

O código é assinado com a chave privada (ECDSA P-256). Os apps só têm a chave
pública, então não é possível gerar códigos sem este arquivo. Guarde a chave
privada fora do repositório e faça backup dela.

Precisa só do Python 3 e do comando `openssl`, que já vêm no macOS.
"""

import argparse
import base64
import datetime as dt
import os
import subprocess
import sys
import tempfile

DEFAULT_KEY = os.path.expanduser("~/Documents/PrintKiosk-Licencas/printkiosk-chave-privada.pem")
EPOCH = dt.date(2024, 1, 1)
VERSION = 1


def parse_store_code(text: str) -> bytes:
    cleaned = text.replace("-", "").replace(" ", "").upper()
    if len(cleaned) != 8:
        sys.exit("O código da loja tem 8 letras/números, por exemplo ABCD-EFGH.")
    try:
        return base64.b32decode(cleaned)
    except Exception:
        sys.exit("Código da loja inválido. Confira as letras (sem 0, 1, 8 ou 9).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera o código de ativação mensal do PrintKiosk.")
    parser.add_argument("loja", help="Código da loja mostrado no app, por exemplo ABCD-EFGH")
    parser.add_argument("--ate", help="Último dia válido, no formato AAAA-MM-DD")
    parser.add_argument("--dias", type=int, default=31, help="Validade em dias a partir de hoje (padrão 31)")
    parser.add_argument("--chave", default=DEFAULT_KEY, help=f"Chave privada (padrão {DEFAULT_KEY})")
    args = parser.parse_args()

    if not os.path.exists(args.chave):
        sys.exit(f"Chave privada não encontrada em {args.chave}")

    store = parse_store_code(args.loja)
    until = dt.date.fromisoformat(args.ate) if args.ate else dt.date.today() + dt.timedelta(days=args.dias)
    days = (until - EPOCH).days
    if not 0 <= days <= 0xFFFF:
        sys.exit("Data fora do intervalo aceito.")

    payload = bytes([VERSION]) + store + days.to_bytes(2, "big")

    with tempfile.NamedTemporaryFile(delete=False) as handle:
        handle.write(payload)
        payload_path = handle.name
    try:
        signature = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", args.chave, payload_path],
            check=True, capture_output=True,
        ).stdout
    finally:
        os.unlink(payload_path)

    code = "PK1-" + base64.urlsafe_b64encode(payload + signature).decode().rstrip("=")
    print(f"Loja:     {args.loja.upper()}")
    print(f"Válido até {until.strftime('%d/%m/%Y')} (inclusive)")
    print()
    print(code)


if __name__ == "__main__":
    main()
