package br.com.somainfo.quioco

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Phone support. The kiosk was drawn for tablets; on a phone (smallest width under 600 dp)
 * the big fixed sizes shrink and side-by-side blocks stack, like the iPhone version.
 */
val LocalCompact = compositionLocalOf { false }

/** Wraps the app so every screen knows whether it is on a phone. */
@Composable
fun ProvideScreenSize(content: @Composable () -> Unit) {
    val configuration = LocalConfiguration.current
    val compact = configuration.smallestScreenWidthDp < 600
    CompositionLocalProvider(LocalCompact provides compact, content = content)
}

/** A tablet size in dp, about 55% of it on a phone (paddings, icons, QR Codes). */
@Composable
fun kd(tablet: Int): Dp = if (LocalCompact.current) (tablet * 0.55f).dp else tablet.dp

/** A tablet text size, about 45–60% of it on a phone, never under 16 sp. */
@Composable
fun ks(tablet: Int): TextUnit {
    if (!LocalCompact.current) return tablet.sp
    val factor = if (tablet >= 100) 0.45f else 0.6f
    return maxOf(16f, tablet * factor).sp
}

/** Buttons side by side on a tablet, one above the other (full width) on a phone. */
@Composable
fun AdaptiveRow(spacing: Dp = 20.dp, content: @Composable () -> Unit) {
    if (LocalCompact.current) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) { content() }
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(spacing), verticalAlignment = Alignment.CenterVertically) { content() }
    }
}
