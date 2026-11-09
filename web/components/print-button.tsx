"use client";

export function PrintButton() {
  return <button className="btn btn-primary" type="button" onClick={() => window.print()}>Imprimir</button>;
}
