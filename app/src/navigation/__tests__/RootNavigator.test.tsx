import { render, screen } from '@testing-library/react-native';
import { RootNavigator } from '../RootNavigator';

test('shows both role-selection options on first launch', async () => {
  // @testing-library/react-native v14 (React 19) makes `render` async — must be awaited before
  // `screen` is populated, otherwise every `screen` query throws "render function has not been
  // called".
  await render(<RootNavigator />);

  expect(await screen.findByText("I'm a parent")).toBeTruthy();
  expect(await screen.findByText("I'm on my child's device")).toBeTruthy();
});
