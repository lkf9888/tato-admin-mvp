package co.tatocar.app;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;

/**
 * TATO in a WebView.
 *
 * This replaced a Trusted Web Activity, which was the better-looking
 * option and the wrong one: a TWA is hosted by a browser that supports
 * Custom Tabs -- in practice Chrome -- and on a device without one it
 * degrades or fails outright. A WebView is a system component that
 * ships with essentially every Android build, including the ones that
 * have no Chrome at all.
 *
 * The cost of that trade is that a WebView starts out unable to do
 * several things the site needs, and fails at all of them silently.
 * Everything below exists because leaving it out breaks a feature
 * without producing an error anyone could act on:
 *
 *   - DOM storage: the calendar remembers list-vs-timeline in
 *     localStorage. Off by default.
 *   - Cookies, flushed on pause: the login session. Without the flush
 *     it survives until the process dies and then quietly does not.
 *   - File chooser: photo and document upload. A WebView with no
 *     `onShowFileChooser` shows the picker never and reports nothing.
 *   - Download listener: the PDF exports. A WebView ignores downloads
 *     unless told where to send them.
 *   - External schemes: `tel:` on a guest's number, maps links,
 *     turo.com. A WebView tries to load them itself and lands on an
 *     error page.
 *
 * There is deliberately no pull-to-refresh. The calendar pans
 * horizontally under the finger, and a vertical gesture handler
 * wrapped around it competes for drags that are a few degrees off
 * horizontal -- the exact failure the calendar's own drag handling had
 * to be fixed for. The site renders on the server, so every navigation
 * is already fresh and there is no stale view to pull away.
 */
public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ProgressBar progressBar;
    private View errorView;

    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<String> storagePermissionLauncher;
    /** Held across the permission prompt so the download can be
     *  retried with the answer. */
    private Runnable pendingDownload;

    /** Set when a page load fails, so `onPageFinished` knows not to
     *  reveal a WebView showing its own error markup. */
    private boolean loadFailed;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.web_view);
        progressBar = findViewById(R.id.progress);
        errorView = findViewById(R.id.error_view);

        findViewById(R.id.retry_button).setOnClickListener(v -> reload());

        registerFileChooser();
        registerStoragePermission();
        configureWebView();
        configureCookies();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(resolveStartUrl(getIntent()));
        }

        // Back goes back through the site's own history first, and only
        // leaves the app once there is nothing left to go back to.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /** A tapped tatocar.co link that opened the app arrives here; a
     *  plain launch does not, and gets the dashboard. */
    private String resolveStartUrl(Intent intent) {
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            Uri data = intent.getData();
            if (isAppHost(data)) return data.toString();
        }
        return getString(R.string.start_url);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = resolveStartUrl(intent);
        if (!url.equals(getString(R.string.start_url))) webView.loadUrl(url);
    }

    private boolean isAppHost(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equals(getString(R.string.app_host))
                || host.endsWith("." + getString(R.string.app_host)));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // The site is responsive and sets its own tap targets; the
        // pinch-zoom controls only get in the way of a calendar that
        // pans horizontally.
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Appended rather than replaced: the site does its layout by
        // width and never sniffs this, but leaving the real WebView UA
        // intact means anything that ever does sniff still gets the
        // truth, with a marker after it.
        settings.setUserAgentString(settings.getUserAgentString() + " TATOApp/" + BuildConfig.VERSION_NAME);

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isAppHost(url)) return false;
                // Anything not on the site -- a guest's phone number, a
                // maps link, Turo itself -- belongs to whatever app
                // handles it. A WebView would try to render `tel:` and
                // show an error instead of opening the dialer.
                return openExternally(url);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                if (!loadFailed) {
                    errorView.setVisibility(View.GONE);
                    webView.setVisibility(View.VISIBLE);
                }
                // Written to disk now rather than at process death, so
                // the session is still there after a force-stop.
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Only the main document. A failed image or analytics
                // beacon is not a reason to replace the whole page with
                // "no connection".
                if (!request.isForMainFrame()) return;
                loadFailed = true;
                showError();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress >= 100) progressBar.setVisibility(View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    fileChooserLauncher.launch(buildFileChooserIntent(params));
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    toast(R.string.no_file_picker);
                    return false;
                }
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                downloadFile(url, userAgent, contentDisposition, mimeType);
            }
        });
    }

    private void configureCookies() {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        // The session cookie is first-party, but the WebView treats
        // itself as a third-party context in enough situations that
        // leaving this off produces intermittent logouts.
        cookies.setAcceptThirdPartyCookies(webView, true);
    }

    // ---- File upload -----------------------------------------------

    private void registerFileChooser() {
        fileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (filePathCallback == null) return;
                    Uri[] uris = null;
                    if (result.getResultCode() == RESULT_OK) {
                        Intent data = result.getData();
                        if (data != null && data.getData() != null) {
                            uris = new Uri[]{data.getData()};
                        } else if (data != null && data.getClipData() != null) {
                            int count = data.getClipData().getItemCount();
                            uris = new Uri[count];
                            for (int i = 0; i < count; i++) {
                                uris[i] = data.getClipData().getItemAt(i).getUri();
                            }
                        } else if (cameraOutputUri != null) {
                            // A camera app that succeeded returns no data:
                            // the photo is at the Uri we handed it.
                            uris = new Uri[]{cameraOutputUri};
                        }
                    }
                    // Must be called on every path, including cancel.
                    // A WebView whose callback never fires leaves the
                    // file input permanently unresponsive.
                    filePathCallback.onReceiveValue(uris);
                    filePathCallback = null;
                    cameraOutputUri = null;
                });
    }

    private Intent buildFileChooserIntent(WebChromeClient.FileChooserParams params) {
        Intent content = params.createIntent();
        content.addCategory(Intent.CATEGORY_OPENABLE);

        Intent chooser = Intent.createChooser(content, getString(R.string.choose_file));

        // Offer the camera alongside the picker. Photographing a car at
        // handover is most of why this app is on a phone, and the
        // system picker does not always surface a camera on its own.
        Intent camera = buildCameraIntent();
        if (camera != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        return chooser;
    }

    private Intent buildCameraIntent() {
        Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (capture.resolveActivity(getPackageManager()) == null) return null;
        try {
            File dir = new File(getCacheDir(), "uploads");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File photo = File.createTempFile("tato_", ".jpg", dir);
            cameraOutputUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", photo);
            capture.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            capture.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return capture;
        } catch (IOException e) {
            cameraOutputUri = null;
            return null;
        }
    }

    // ---- Downloads --------------------------------------------------

    private void registerStoragePermission() {
        storagePermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    Runnable retry = pendingDownload;
                    pendingDownload = null;
                    // Runs either way. Denied means the file lands in
                    // app-private storage instead of the shared
                    // Downloads folder, which is worse but not a
                    // failure -- refusing to download at all would be.
                    if (retry != null) retry.run();
                });
    }

    private boolean needsLegacyStoragePermission() {
        // Android 10 removed the permission requirement for writing
        // into the shared Downloads collection. Below it, enqueueing
        // without the grant throws and the download never starts.
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && ContextCompat.checkSelfPermission(this,
                        android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED;
    }

    private void downloadFile(String url, String userAgent, String contentDisposition, String mimeType) {
        if (needsLegacyStoragePermission() && pendingDownload == null) {
            pendingDownload = () -> downloadFile(url, userAgent, contentDisposition, mimeType);
            storagePermissionLauncher.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
            return;
        }
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", userAgent);
            // The session lives in the WebView's cookie jar, and
            // DownloadManager runs outside it -- without this header a
            // download of anything behind the login is a redirect to
            // the sign-in page saved as a file.
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            String name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
            request.setTitle(name);
            request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (needsLegacyStoragePermission()) {
                // The prompt was shown and refused. App-private
                // storage needs no permission at any API level; the
                // completion notification still opens the file.
                request.setDestinationInExternalFilesDir(
                        this, Environment.DIRECTORY_DOWNLOADS, name);
            } else {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            }

            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                toast(R.string.download_failed);
                return;
            }
            manager.enqueue(request);
            toast(R.string.download_started);
        } catch (Exception e) {
            toast(R.string.download_failed);
        }
    }

    // ---- External links ---------------------------------------------

    private boolean openExternally(Uri url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, url);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            toast(R.string.no_handler);
            // Handled either way: letting the WebView try instead would
            // put an error page where the app used to be.
            return true;
        }
    }

    // ---- Plumbing ----------------------------------------------------

    private void reload() {
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        loadFailed = false;
        if (webView.getUrl() == null) {
            webView.loadUrl(getString(R.string.start_url));
        } else {
            webView.reload();
        }
    }

    private void showError() {
        progressBar.setVisibility(View.GONE);
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    private void toast(int resId) {
        Toast.makeText(this, resId, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }
}
