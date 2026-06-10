import { App } from '@slack/bolt';

/**
 * OAuth install handler — stubbed for Socket Mode (local dev).
 * Will be fully implemented during server deployment.
 */
export function registerInstallHandler(_app: App): void {
  console.log('ℹ️  Install handler skipped (Socket Mode)');
}