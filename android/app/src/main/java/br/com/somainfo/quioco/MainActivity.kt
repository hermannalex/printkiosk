package br.com.somainfo.quioco

import android.os.Bundle
import android.print.PrintManager
import android.view.MotionEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels

class MainActivity : ComponentActivity() {
    private val viewModel: KioskViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep the screen awake while the kiosk is running.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        viewModel.printLauncher = { adapter, jobName ->
            val printManager = getSystemService(PRINT_SERVICE) as PrintManager
            printManager.print(jobName, adapter, null)
        }

        setContent {
            KioskTheme {
                KioskApp(
                    vm = viewModel,
                    onPinScreen = { runCatching { startLockTask() } },
                    onUnpinScreen = { runCatching { stopLockTask() } },
                )
            }
        }
    }

    override fun onDestroy() {
        viewModel.printLauncher = null
        super.onDestroy()
    }

    /** Every touch anywhere counts as activity, so the idle timer only resets an abandoned kiosk. */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        viewModel.registerInteraction()
        return super.dispatchTouchEvent(ev)
    }
}
