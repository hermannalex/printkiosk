package br.com.somainfo.quioco

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import java.net.Inet4Address

/**
 * Finds IPP printers on the store's Wi-Fi (Bonjour/mDNS "_ipp._tcp") so staff can pick one
 * instead of typing an address. Results are delivered on the main thread; the search stops by itself.
 */
class PrinterDiscovery(context: Context) {
    data class Found(val name: String, val address: String)

    private val nsd = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private var listener: NsdManager.DiscoveryListener? = null
    private val pending = ArrayDeque<NsdServiceInfo>()
    private var resolving = false

    fun start(seconds: Long = 8, onFound: (Found) -> Unit, onFinished: () -> Unit) {
        stop()
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onServiceLost(service: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                main.post { onFinished() }
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceFound(service: NsdServiceInfo) {
                synchronized(pending) { pending.addLast(service) }
                resolveNext(onFound)
            }
        }
        listener = discovery
        try {
            nsd.discoverServices("_ipp._tcp", NsdManager.PROTOCOL_DNS_SD, discovery)
        } catch (e: Exception) {
            main.post { onFinished() }
            return
        }
        main.postDelayed({ stop(); onFinished() }, seconds * 1000)
    }

    fun stop() {
        listener?.let { runCatching { nsd.stopServiceDiscovery(it) } }
        listener = null
        synchronized(pending) { pending.clear() }
        resolving = false
    }

    // Android resolves one service at a time; the rest wait in the queue.
    @Suppress("DEPRECATION")
    private fun resolveNext(onFound: (Found) -> Unit) {
        val next = synchronized(pending) {
            if (resolving || pending.isEmpty()) return
            resolving = true
            pending.removeFirst()
        }
        nsd.resolveService(
            next,
            object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    resolving = false
                    resolveNext(onFound)
                }

                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    resolving = false
                    val host = serviceInfo.host
                    if (host is Inet4Address) {
                        val path = serviceInfo.attributes["rp"]?.let { String(it, Charsets.UTF_8) }?.trim('/')?.ifBlank { null }
                        val address = buildString {
                            append(host.hostAddress)
                            if (serviceInfo.port != 631 || path != null && path != "ipp/print") {
                                append(":").append(serviceInfo.port)
                            }
                            if (path != null && path != "ipp/print") append("/").append(path)
                        }
                        main.post { onFound(Found(serviceInfo.serviceName, address)) }
                    }
                    resolveNext(onFound)
                }
            },
        )
    }
}
