import { AuthGate } from './components/Auth/AuthGate';
import { CalendarPage } from './components/Calendar/CalendarPage';

function App() {
  return (
    <AuthGate>
      <CalendarPage />
    </AuthGate>
  );
}

export default App;
