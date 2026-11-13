import { redirect } from "next/navigation"

/** The home page is the Move page. */
export default function Home() {
  redirect("/move")
}
