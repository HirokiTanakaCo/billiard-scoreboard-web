'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const playerColors = ['#ff4d4d', '#4d79ff', '#44dd44', '#ffaa00']

export default function CreateRoomPage() {
  const router = useRouter()
  const [roomName, setRoomName] = useState('')
  const [playerCount, setPlayerCount] = useState(2)
  const [timerSeconds, setTimerSeconds] = useState(60)
  const [isCreating, setIsCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const createRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')

    const trimmedRoomName = roomName.trim()
    if (!trimmedRoomName || trimmedRoomName.length > 40) {
      setErrorMessage('部屋名は1〜40文字で入力してください。')
      return
    }
    if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) {
      setErrorMessage('人数は2〜4人から選択してください。')
      return
    }
    if (!Number.isInteger(timerSeconds) || timerSeconds < 1 || timerSeconds > 600) {
      setErrorMessage('タイマー値は1〜600秒で入力してください。')
      return
    }

    setIsCreating(true)
    try {
      const generatedRoomId = crypto.randomUUID().replace(/-/g, '')
      const initialPlayers = Array.from({ length: playerCount }, (_, index) => ({
        id: index + 1,
        name: `プレイヤー${index + 1}`,
        score: 0,
        target: 3,
        timer: 0,
        timer_running: false,
        timer_remaining: timerSeconds,
        timer_deadline: null,
        color: playerColors[index],
        is_active: index === 0,
        is_winner: false,
      }))

      const { error } = await supabase.from('billiard_rooms').insert({
        room_id: generatedRoomId,
        room_name: trimmedRoomName,
        players: initialPlayers,
        turn: 1,
        game_type: '9ball',
        winner: null,
        finished: false,
        history: [],
        shot_clock: {
          duration: timerSeconds,
          remaining: timerSeconds,
          running: false,
        },
      })

      if (error) {
        setErrorMessage(
          error.code === '23505'
            ? '部屋IDの自動生成に失敗しました。もう一度作成してください。'
            : '部屋の作成に失敗しました: ' + error.message
        )
        return
      }

      router.push(`/room/${generatedRoomId}`)
    } catch (error) {
      setErrorMessage(
        '部屋の作成に失敗しました: ' +
          (error instanceof Error ? error.message : '不明なエラーが発生しました。')
      )
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: 32, color: '#fff' }}>
      <Link href="/" style={{ color: '#c7d2fe' }}>
        ← ルーム一覧へ戻る
      </Link>
      <h1 style={{ marginTop: 24 }}>新しいルームを作成</h1>

      <form onSubmit={(event) => void createRoom(event)}>
        <div style={{ display: 'grid', gap: 20, marginTop: 24 }}>
          <label style={{ display: 'grid', gap: 8 }}>
            部屋名
            <input
              type="text"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              maxLength={40}
              required
              style={{ padding: 12, borderRadius: 6, fontSize: 16 }}
            />
          </label>

          <label style={{ display: 'grid', gap: 8 }}>
            人数
            <select
              value={playerCount}
              onChange={(event) => setPlayerCount(Number(event.target.value))}
              style={{ padding: 12, borderRadius: 6, fontSize: 16 }}
            >
              {[2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count}人
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 8 }}>
            タイマー値（秒）
            <input
              type="number"
              min={1}
              max={600}
              step={1}
              value={timerSeconds}
              onChange={(event) => setTimerSeconds(Number(event.target.value))}
              required
              style={{ padding: 12, borderRadius: 6, fontSize: 16 }}
            />
          </label>
        </div>

        {errorMessage && (
          <p role="alert" style={{ color: '#ff8b8b', marginTop: 20 }}>
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isCreating}
          style={{
            marginTop: 28,
            padding: '12px 24px',
            borderRadius: 8,
            fontSize: 18,
            cursor: isCreating ? 'wait' : 'pointer',
          }}
        >
          {isCreating ? '作成中...' : 'ルームを作成'}
        </button>
      </form>
    </main>
  )
}
