package com.example.asciiconverter

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import com.example.asciiconverter.ui.theme.AsciiConverterTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AsciiConverterTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AsciiWebView()
                }
            }
        }
    }
}

@Composable
private fun AsciiWebView() {
    val context = LocalContext.current
    var pendingFilePathCallback by remember<ValueCallback<Array<Uri>>?> { mutableStateOf(null) }
    val fileChooserLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = pendingFilePathCallback
        if (callback == null) {
            return@rememberLauncherForActivityResult
        }

        val uris = if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            when {
                data?.clipData != null -> {
                    val clipData = data.clipData!!
                    Array(clipData.itemCount) { index -> clipData.getItemAt(index).uri }
                }

                data?.data != null -> arrayOf(data.data!!)
                else -> emptyArray()
            }
        } else {
            null
        }

        if (uris == null) {
            callback.onReceiveValue(null)
        } else {
            callback.onReceiveValue(uris)
        }
        pendingFilePathCallback = null
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = {
            val loader = WebViewAssetLoader.Builder()
                .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context, "public"))
                .build()

            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                webChromeClient = object : WebChromeClient() {
                    override fun onShowFileChooser(
                        webView: WebView?,
                        callback: ValueCallback<Array<Uri>>?,
                        fileChooserParams: FileChooserParams?,
                    ): Boolean {
                        val chooserCallback = callback ?: return false

                        pendingFilePathCallback?.onReceiveValue(null)
                        pendingFilePathCallback = chooserCallback

                        val intent = try {
                            fileChooserParams?.createIntent()
                                ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                                    addCategory(Intent.CATEGORY_OPENABLE)
                                    type = "image/*"
                                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                                }
                        } catch (e: ActivityNotFoundException) {
                            pendingFilePathCallback = null
                            return false
                        }

                        return try {
                            fileChooserLauncher.launch(intent)
                            true
                        } catch (e: ActivityNotFoundException) {
                            pendingFilePathCallback = null
                            false
                        }
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): Boolean {
                        val url = request?.url ?: return false
                        return if (url.host == "appassets.androidplatform.net") {
                            false
                        } else {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.toString())))
                            true
                        }
                    }

                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ) = WebViewCompat.shouldInterceptRequest(view, loader, request)
                }
                loadUrl("https://appassets.androidplatform.net/index.html")
            }
        },
        update = { webView ->
            if (webView.url.isNullOrBlank()) {
                webView.loadUrl("https://appassets.androidplatform.net/index.html")
            }
        },
    )
}
