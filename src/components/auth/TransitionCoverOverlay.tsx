// ─── TransitionCoverOverlay ────────────────────────────────────────────────
// Hosts the SAME SignupSurface cover — unchanged, not duplicated — inside a
// platform-appropriate NATIVE container instead of a plain sibling View with
// zIndex/elevation. A plain RN View is composited within the normal RN view
// hierarchy; react-native-screens' native-stack uses its own native
// containers (UIViewController transitions on iOS, Fragment transactions on
// Android) which can transiently sit ABOVE that hierarchy during a route
// removal, regardless of zIndex/elevation. This is the standard fix used for
// any overlay (toast, snackbar, cover) that must survive a native-stack
// transition:
//   iOS:     FullWindowOverlay (react-native-screens) — renders into a
//            separate native UIWindow layer above the whole app, including
//            any in-flight screen transition.
//   Android: a root-level Modal — renders into its own native Window,
//            above the Activity's view hierarchy including any Fragment
//            transition.
//
// The SAME visual snapshot / SignupSurface props are used in both branches.
// This component itself is mounted/unmounted by the caller (_layout.tsx)
// exactly as before (gated on showCoverOverlay && visual) — its OWN internal
// branch (iOS vs Android) is resolved once via Platform.OS, which never
// changes at runtime, so it does not introduce any additional remount
// between the ACTIVE and DATA_READY_COVERED phases.

import { Platform, View, Modal, StyleSheet } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { SignupSurface } from '@/components/auth/SignupSurface';
import type { SignupVisualSnapshot } from '@/lib/transitionLease';

interface TransitionCoverOverlayProps {
  visible: boolean;
  visual: SignupVisualSnapshot;
}

const BG = '#F7F2E7';

export function TransitionCoverOverlay({ visible, visual }: TransitionCoverOverlayProps) {
  if (!visible) return null;

  const content = (
    <View style={styles.coverRoot}>
      <SignupSurface
        email={visual.email}
        password={visual.password}
        confirm={visual.confirm}
        showPw={visual.showPw}
        showConfirm={visual.showConfirm}
        loading={true}
        error={null}
        emailFocused={false}
        passwordFocused={false}
        confirmFocused={false}
      />
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay>
        {content}
      </FullWindowOverlay>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={false}
      hardwareAccelerated
      statusBarTranslucent
      navigationBarTranslucent
      // The back button must never dismiss the cover mid-transition — the
      // cover is only ever removed by the dashboard's own onLayout signal
      // (see _layout.tsx / signalDashboardReady), never by user input.
      onRequestClose={() => {}}
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  coverRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
  },
});
