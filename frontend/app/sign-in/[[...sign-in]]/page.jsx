import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0', background: '#faf9f7', minHeight: '100vh' }}>
      <SignIn />
    </div>
  )
}
