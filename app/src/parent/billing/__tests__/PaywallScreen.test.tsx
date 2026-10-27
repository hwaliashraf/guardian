import { Alert } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TIER_DEVICE_LIMIT, TIER_FEATURES } from '@guardian/domain';
import type { Tier } from '@guardian/domain';
import PaywallScreen from '../PaywallScreen';

const TIERS: Tier[] = ['free', 'standard', 'premium'];

beforeEach(() => {
  jest.clearAllMocks();
});

// Sourced directly from T06's real exports (not a hand-copied expected list) — the point of
// this test is to catch the screen's render ever drifting from TIER_FEATURES/TIER_DEVICE_LIMIT,
// so the expectations themselves must come from the same source of truth, not a second copy.
test('renders every tier, every feature, and every device limit exactly as TIER_FEATURES/TIER_DEVICE_LIMIT define them', async () => {
  await render(<PaywallScreen />);

  for (const tier of TIERS) {
    expect(screen.getByTestId(`paywall-tier-${tier}`)).toBeTruthy();
    expect(screen.getByTestId(`paywall-tier-${tier}-device-limit`)).toHaveTextContent(
      new RegExp(`\\b${TIER_DEVICE_LIMIT[tier]}\\b`),
    );
    for (const feature of TIER_FEATURES[tier]) {
      expect(screen.getByTestId(`paywall-tier-${tier}-feature-${feature}`)).toBeTruthy();
    }
  }
});

test('a feature not in a tier is not rendered under that tier', async () => {
  await render(<PaywallScreen />);

  // vpn_shield is premium-only (T06) — must not appear under free or standard.
  expect(screen.queryByTestId('paywall-tier-free-feature-vpn_shield')).toBeNull();
  expect(screen.queryByTestId('paywall-tier-standard-feature-vpn_shield')).toBeNull();
  expect(screen.getByTestId('paywall-tier-premium-feature-vpn_shield')).toBeTruthy();
});

test('contact-us CTA is a placeholder, not a real purchase flow', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  await render(<PaywallScreen />);
  await fireEvent.press(screen.getByTestId('paywall-contact-us'));

  expect(alertSpy).toHaveBeenCalledWith('Contact us to upgrade', expect.stringContaining('support@guardian.example'));
});
