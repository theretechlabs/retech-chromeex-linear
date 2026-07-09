const LINEAR_API = 'https://api.linear.app/graphql'

export interface LinearIssue {
  id: string
  identifier: string
  title: string
}

async function gql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  let res: Response
  try {
    res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Personal API keys vão direto no header, sem "Bearer".
        Authorization: apiKey
      },
      body: JSON.stringify({ query, variables })
    })
  } catch {
    throw new Error('Falha de rede ao chamar a API do Linear')
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('API key do Linear inválida — verifique nas opções da extensão')
  }

  const json = (await res.json()) as {
    data?: T
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) throw new Error(`Linear API: ${json.errors[0].message}`)
  if (!json.data) throw new Error('Linear API: resposta vazia')
  return json.data
}

/** Aceita identifier humano (THE-558) ou UUID. */
export async function resolveIssue(apiKey: string, identifier: string): Promise<LinearIssue> {
  const data = await gql<{ issue: LinearIssue | null }>(
    apiKey,
    `query IssueById($id: String!) {
      issue(id: $id) { id identifier title }
    }`,
    { id: identifier }
  )
  if (!data.issue) throw new Error(`Issue ${identifier} não encontrada`)
  return data.issue
}

export async function createComment(
  apiKey: string,
  issueId: string,
  body: string
): Promise<void> {
  const data = await gql<{ commentCreate: { success: boolean } }>(
    apiKey,
    `mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId, body } }
  )
  if (!data.commentCreate.success) throw new Error('Linear recusou o comentário')
}

/** Valida a API key e retorna o nome do usuário. */
export async function whoAmI(apiKey: string): Promise<string> {
  const data = await gql<{ viewer: { name: string } }>(
    apiKey,
    `query { viewer { name } }`,
    {}
  )
  return data.viewer.name
}
