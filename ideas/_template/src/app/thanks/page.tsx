import Link from "next/link";

export default function ObrigadoPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold">Recebemos seu cadastro.</h1>
      <p className="text-muted-foreground">
        Você receberá novidades por e-mail. Enquanto isso, fique de olho na caixa de entrada.
      </p>
      <Link href="/" className="text-sm underline">
        Voltar
      </Link>
    </main>
  );
}
