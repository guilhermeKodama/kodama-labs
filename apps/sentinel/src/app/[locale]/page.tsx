import { redirect } from "@/i18n/navigation";

export default function HomePage() {
  redirect({ href: "/dashboard", locale: "pt-BR" });
}
