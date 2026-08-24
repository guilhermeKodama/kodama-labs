import Link from "next/link";
import { env } from "@/env";
import { PushSetup } from "@/components/push-setup";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-5 py-10">
      <div>
        <h1 className="text-xl font-medium">Attention — POC</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Teste se este servidor consegue notificar seu iPhone através do Foco, sem app nativo.
        </p>
      </div>

      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-neutral-300">
        <li>No Safari do iPhone: Compartilhar → Adicionar à Tela de Início.</li>
        <li>Abra pela tela de início (não pelo Safari) e toque em &quot;Ativar notificações&quot;.</li>
        <li>Em Ajustes → Foco, adicione este app à allowlist de cada modo.</li>
        <li>
          Acompanhe os resultados em{" "}
          <Link href="/lab" className="underline underline-offset-2">
            /lab
          </Link>
          .
        </li>
      </ol>

      <PushSetup vapidPublicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
    </main>
  );
}
