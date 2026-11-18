import { redirect } from "next/navigation";

/** La bandeja de chats web es ahora "Hoy"; esta ruta queda por los enlaces viejos. */
export default function ChatsWebJefePage() {
  redirect("/jefe");
}
