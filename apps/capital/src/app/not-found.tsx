import "./globals.css";
import messages from "@/messages/pt-BR/shell.json";
import { BODY_CLASS } from "./fonts";
import { NotFoundView } from "./not-found-view";

// Requests the middleware does not localize (a path with a dot, an
// unknown locale segment) end here, outside [locale]: no language is
// known yet, so it is the pt-BR page with its own document.
export default function GlobalNotFound() {
  return (
    <html lang="pt-BR">
      <body className={BODY_CLASS}>
        <NotFoundView title={messages.notFound.title} description={messages.notFound.description} back={messages.notFound.back} />
      </body>
    </html>
  );
}
