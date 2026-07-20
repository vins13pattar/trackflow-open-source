import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/lib/auth';
import { type AlertLink, parseAlertLink } from './src/lib/deep-link';
import { colors } from './src/lib/theme';
import { AlertDetailScreen } from './src/screens/AlertDetailScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';

function Root() {
  const { ready, signedIn } = useAuth();
  const [deepLink, setDeepLink] = useState<AlertLink | null>(null);

  useEffect(() => {
    // Cold-start: notification that launched the app.
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      const link = parseAlertLink(resp?.notification.request.content.data as Record<string, unknown> | undefined);
      if (link) setDeepLink(link);
    });
    // Warm tap: user taps a notification while the app is running.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const link = parseAlertLink(resp.notification.request.content.data as Record<string, unknown> | undefined);
      if (link) setDeepLink(link);
    });
    return () => sub.remove();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!signedIn) return <LoginScreen />;
  if (deepLink) return <AlertDetailScreen alertId={deepLink.alertId} onClose={() => setDeepLink(null)} />;
  return <HomeScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Root />
    </AuthProvider>
  );
}
