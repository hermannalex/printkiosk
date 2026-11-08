package br.com.somainfo.quioco

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val KioskBlue = Color(0xFF1D6FE0)
val KioskGreen = Color(0xFF2E9E5B)
val KioskOrange = Color(0xFFE08A1D)

/** A fixed light look: the kiosk should look the same whatever the tablet's dark-mode setting. */
@Composable
fun KioskTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = KioskBlue,
            onPrimary = Color.White,
            secondaryContainer = Color(0xFFDCE7FA),
            onSecondaryContainer = Color(0xFF0E3C80),
            background = Color(0xFFF2F4F7),
            surface = Color.White,
            surfaceVariant = Color(0xFFE9ECF1),
            onSurfaceVariant = Color(0xFF5B6472),
        ),
        content = content,
    )
}
