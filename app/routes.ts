import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/tournament", "routes/tournament.tsx"),
  route("/tournament/:id/signup", "routes/signup.tsx"),
  route("/tournament/:id/player", "routes/player.tsx"),
  route("/tournament/:id/bracket", "routes/tournamentBracket.tsx"),
  route("/tournament/:id/anthem", "routes/anthem.tsx"),
] satisfies RouteConfig;
