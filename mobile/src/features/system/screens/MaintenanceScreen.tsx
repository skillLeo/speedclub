import { useTranslation } from 'react-i18next';

import { useAppConfig } from '@/api/queries/appConfig';

import { GateScreen } from './GateScreen';

/** SYS-02. The message comes from app-config when the team wrote one. */
export function MaintenanceScreen() {
  const { t } = useTranslation('common');
  const { config } = useAppConfig();
  return (
    <GateScreen
      routeId="SYS-02"
      title={t('gate.maintenanceTitle')}
      body={config.maintenance.message || t('gate.maintenanceBody')}
    />
  );
}
