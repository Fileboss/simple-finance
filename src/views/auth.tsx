import { Layout, Notice } from "./layout.tsx";

export function LoginForm(props: { error?: string }) {
  return (
    <Layout title="Connexion" path="/login">
      <form method="post" action="/login" class="card auth">
        <h1>Connexion</h1>
        {props.error && <Notice kind="error">{props.error}</Notice>}
        <label>
          Identifiant
          <input type="text" name="name" autocomplete="username" autocapitalize="none" spellcheck={false} required autofocus />
        </label>
        <label>
          Mot de passe
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <p class="actions">
          <button type="submit">Se connecter</button>
        </p>
      </form>
    </Layout>
  );
}

export function PasswordForm(props: { name: string; required: boolean; error?: string }) {
  return (
    <Layout title="Mot de passe" path="/mot-de-passe">
      <form method="post" action="/mot-de-passe" class="card auth">
        <h1>{props.required ? "Choisis ton mot de passe" : "Changer le mot de passe"}</h1>
        {props.required && <p class="muted">Ce mot de passe est temporaire : remplace-le pour accéder à tes données.</p>}
        {props.error && <Notice kind="error">{props.error}</Notice>}
        {/* Pour les gestionnaires de mots de passe. */}
        <input type="text" name="username" value={props.name} autocomplete="username" hidden />
        <label>
          {props.required ? "Mot de passe temporaire" : "Mot de passe actuel"}
          <input type="password" name="current" autocomplete="current-password" required autofocus />
        </label>
        <label>
          Nouveau mot de passe (15 caractères minimum)
          <input type="password" name="password" autocomplete="new-password" minlength={15} required />
        </label>
        <label>
          Confirmation
          <input type="password" name="confirm" autocomplete="new-password" minlength={15} required />
        </label>
        <p class="actions">
          <button type="submit">Enregistrer</button>
        </p>
      </form>
    </Layout>
  );
}
