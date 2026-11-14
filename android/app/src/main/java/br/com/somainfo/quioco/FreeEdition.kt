package br.com.somainfo.quioco

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * imprime-free: the "free" product flavor. It prints for free with no limit, has no payments,
 * license or dashboard, and shows house ads for the paid imprime.ai app.
 */
object Edition {
    val FREE: Boolean = BuildConfig.FREE
    const val AD_URL = "https://imprime.ai/?origem=imprime-free"
}

private data class HouseAdText(val title: String, val body: String)

private val HOUSE_ADS = listOf(
    HouseAdText("Cobre pelas impressões com Pix", "Com o imprime.ai o cliente paga com Pix e o dinheiro cai direto na sua conta."),
    HouseAdText("Painel online da loja", "Faturamento, páginas impressas e horários de pico de cada quiosque, de qualquer lugar."),
    HouseAdText("Cartão por aproximação", "Aceite crédito, débito, Apple Pay e Google Pay na maquininha do Mercado Pago."),
    HouseAdText("Vouchers de crédito", "Crie créditos de impressão para promoções, troco ou clientes fiéis."),
    HouseAdText("Tem uma loja? Tenha um quiosque assim", "Transforme a sua impressora num autoatendimento. Baixe em imprime.ai."),
)

private val AdIndigo = Color(0xFF4F46E5)
private val AdInk = Color(0xFF312E81)

/** A rotating ad card for imprime.ai, with a QR Code to the site. Shows nothing in the paid app. */
@Composable
fun HouseAd(modifier: Modifier = Modifier) {
    if (!Edition.FREE) return
    var index by remember { mutableIntStateOf((HOUSE_ADS.indices).random()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(9_000)
            index = (index + 1) % HOUSE_ADS.size
        }
    }
    val ad = HOUSE_ADS[index]
    Card(
        modifier = modifier.widthIn(max = 600.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        border = BorderStroke(2.dp, Color(0xFFC7D2FE)),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            QrImage(payload = Edition.AD_URL, modifier = Modifier.size(if (LocalCompact.current) 76.dp else 104.dp))
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("ANÚNCIO · IMPRIME.AI", style = MaterialTheme.typography.labelSmall, color = Color(0xFF6B7280))
                Text(ad.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = AdInk)
                Text(ad.body, style = MaterialTheme.typography.bodyMedium, color = Color(0xFF374151))
                Text("imprime.ai · 10 impressões grátis para testar", style = MaterialTheme.typography.labelMedium, color = AdIndigo)
            }
        }
    }
}

/** Settings card in imprime-free: what this version is, and where to get the paid one. */
@Composable
fun UpgradeCard() {
    Card(border = BorderStroke(2.dp, Color(0xFFC7D2FE))) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("imprime-free", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("Esta versão imprime de graça, sem limite e sem pagamento, e mostra anúncios do imprime.ai.")
            Text(
                "Quer cobrar pelas impressões? O imprime.ai completo recebe por Pix, cartão por aproximação e vouchers, " +
                    "com painel online de faturamento, relatórios e ajustes à distância.",
            )
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                QrImage(payload = Edition.AD_URL, modifier = Modifier.size(110.dp))
                Text(
                    "Aponte a câmera ou acesse imprime.ai para baixar. As 10 primeiras impressões são grátis.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
