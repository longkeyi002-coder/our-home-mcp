package com.hermes.companion.push

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * OH-P2: notification destination for a proactive message.
 *
 * This is intentionally an in-app, non-exported surface. It prevents a notification tap
 * from falling back to the Companion settings home while the full Our Home /chat frontend
 * still has no stable App Link URL. The destination contract remains /chat so this activity
 * can later be replaced by the real chat host without changing Runtime/FCM payloads.
 */
class ChatMessageActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val message = NotificationMessage.fromExtras(
            candidateId = intent.getStringExtra(HermesNotifications.EXTRA_CANDIDATE_ID),
            title = intent.getStringExtra(HermesNotifications.EXTRA_MESSAGE_TITLE),
            body = intent.getStringExtra(HermesNotifications.EXTRA_MESSAGE_BODY),
            destination = intent.getStringExtra(HermesNotifications.EXTRA_DESTINATION),
        )
        setContent {
            Scaffold { padding ->
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(horizontal = 22.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    Text("Our Home", style = MaterialTheme.typography.headlineMedium)
                    Text("哥哥", style = MaterialTheme.typography.titleLarge)
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (message.title.isNotBlank() && message.title != "哥哥") {
                                Text(message.title, style = MaterialTheme.typography.titleMedium)
                            }
                            Text(
                                message.body.ifBlank { "哥哥给你发来了一条消息。" },
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                    }
                    Text(
                        "这里是通知对应的消息入口。完整聊天界面接入稳定 /chat App Link 后会直接替换这里。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Button(onClick = { finish() }, modifier = Modifier.fillMaxWidth()) {
                        Text("返回")
                    }
                }
            }
        }
    }
}

data class NotificationMessage(
    val candidateId: String,
    val title: String,
    val body: String,
    val destination: String,
) {
    companion object {
        fun fromExtras(candidateId: String?, title: String?, body: String?, destination: String?): NotificationMessage =
            NotificationMessage(
                candidateId = candidateId.orEmpty(),
                title = title.orEmpty(),
                body = body.orEmpty(),
                destination = destination.takeUnless { it.isNullOrBlank() } ?: HermesNotifications.CHAT_DESTINATION,
            )
    }
}
