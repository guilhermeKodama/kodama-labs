import { useTranslations } from 'next-intl';
import { NotFoundView } from '../not-found-view';

export default function NotFound() {
  const t = useTranslations('shell.notFound');
  return <NotFoundView title={t('title')} description={t('description')} back={t('back')} />;
}
