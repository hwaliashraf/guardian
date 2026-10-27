import { render, screen, fireEvent } from '@testing-library/react-native';
import PermissionsDisclosureScreen from '../PermissionsDisclosureScreen';

const navigation = { navigate: jest.fn() } as never;
const route = { key: 'k', name: 'PermissionsDisclosure' as const, params: undefined };

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders every permission disclosure', async () => {
  await render(<PermissionsDisclosureScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('disclosure-accessibility')).toHaveTextContent(/Accessibility Service/);
  expect(screen.getByTestId('disclosure-accessibility')).toHaveTextContent(/scan on-screen text/);

  expect(screen.getByTestId('disclosure-vpn')).toHaveTextContent(/Local VPN/);
  expect(screen.getByTestId('disclosure-vpn')).toHaveTextContent(/filter which websites/);

  expect(screen.getByTestId('disclosure-deviceAdmin')).toHaveTextContent(/Device Administrator/);
  expect(screen.getByTestId('disclosure-deviceAdmin')).toHaveTextContent(/cannot simply uninstall/);

  expect(screen.getByTestId('disclosure-camera')).toHaveTextContent(/Camera \(presence detection\)/);
  expect(screen.getByTestId('disclosure-camera')).toHaveTextContent(/never saves, stores, or sends any camera/);
});

test('Continue navigates to PairDevice', async () => {
  await render(<PermissionsDisclosureScreen route={route} navigation={navigation} />);

  fireEvent.press(screen.getByTestId('disclosure-continue'));

  expect((navigation as unknown as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('PairDevice');
});
