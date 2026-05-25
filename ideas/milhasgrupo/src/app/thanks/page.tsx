import Link from "next/link";

export default function ObrigadoPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold">Viagem cadastrada. ✈️</h1>
      <p className="text-muted-foreground">
        A partir de agora, monitoramos Azul Fidelidade, LATAM Pass e Smiles para o seu
        trajeto e janela. Quando aparecerem assentos suficientes para a família inteira
        no mesmo voo, você recebe o alerta no Telegram ou WhatsApp com o link e o passo a passo.
      </p>
      <p className="text-sm text-muted-foreground">
        Próximos passos: confira o e-mail de confirmação (verifique o spam se não vir em 5 min).
      </p>
      <Link href="/" className="text-sm underline">
        Voltar para o início
      </Link>
    </main>
  );
}
