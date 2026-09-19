import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { reportError } from '../lib/errorReporting';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Catches render-phase exceptions anywhere below it.
 *
 * Without this, one bad render unmounts the whole tree and the user is
 * left staring at a black screen with no way forward and no report
 * reaching anyone. React only surfaces render errors through a class
 * component, which is why this isn't a hook.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void reportError(error, 'render', info.componentStack?.slice(0, 500) ?? undefined);
  }

  handleReset = () => {
    // On web a reload is the most reliable way back to a known state;
    // on native, clearing the error re-renders the subtree.
    if (Platform.OS === 'web') {
      try {
        window.location.reload();
        return;
      } catch {
        // fall through
      }
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🛰️</Text>
        <Text style={styles.title}>Lost signal</Text>
        <Text style={styles.body}>
          Something broke on our end. The problem has been reported.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.handleReset}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emoji: { fontSize: 44, marginBottom: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: {
    color: '#9ca3af',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
