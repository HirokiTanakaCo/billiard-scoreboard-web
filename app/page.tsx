'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type RoomSummary = {
  room_id: string
  room_name: string | null
  game_type: string | null
  players: Array<{
    name?: string
    score?: number
    target?: number
  }> | null
  finished: boolean | null
  updated_at: string | null
}

const gameNames: Record<string, string> = {
  '9ball': '9ボール',
  '10ball': '10ボール',
  '8ball': '8ボール',
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export default function HomePage() {
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null)

  const fetchRooms = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      return await supabase
        .from('billiard_rooms')
        .select('room_id, room_name, game_type, players, finished, updated_at')
        .order('updated_at', { ascending: false })
        .limit(20)
        .abortSignal(controller.signal)
    } finally {
      clearTimeout(timeoutId)
    }
  }, [])

  const loadRooms = useCallback(async () => {
    setLoadingRooms(true)
    setRoomsError(null)

    try {
      const { data, error } = await fetchRooms()
      if (error) {
        setRoomsError('ルーム一覧を読み込めませんでした: ' + error.message)
        return
      }

      setRooms((data ?? []) as RoomSummary[])
    } catch (error) {
      setRoomsError('ルーム一覧を読み込めませんでした: ' + getErrorMessage(error))
    } finally {
      setLoadingRooms(false)
    }
  }, [fetchRooms])

  const editRoomName = async (room: RoomSummary) => {
    const currentName = room.room_name?.trim() || room.room_id
    const enteredName = window.prompt('新しい部屋名を入力してください', currentName)
    if (enteredName === null) return

    const roomName = enteredName.trim()
    if (!roomName) {
      alert('部屋名を入力してください。')
      return
    }
    if (roomName.length > 40) {
      alert('部屋名は40文字以内で入力してください。')
      return
    }

    const { error } = await supabase
      .from('billiard_rooms')
      .update({ room_name: roomName })
      .eq('room_id', room.room_id)

    if (error) {
      alert('部屋名を保存できませんでした: ' + error.message)
      return
    }

    await loadRooms()
  }

  const deleteRoom = async (roomId: string) => {
    if (!window.confirm(`部屋「${roomId}」を削除しますか？この操作は取り消せません。`)) {
      return
    }

    setDeletingRoomId(roomId)
    try {
      const { error } = await supabase
        .from('billiard_rooms')
        .delete()
        .eq('room_id', roomId)

      if (error) {
        alert('部屋を削除できませんでした: ' + error.message)
        return
      }

      await loadRooms()
    } catch (error) {
      alert('部屋を削除できませんでした: ' + getErrorMessage(error))
    } finally {
      setDeletingRoomId(null)
    }
  }

  useEffect(() => {
    let active = true

    const loadInitialRooms = async () => {
      try {
        const { data, error } = await fetchRooms()
        if (!active) return

        if (error) {
          setRoomsError('ルーム一覧を読み込めませんでした: ' + error.message)
        } else {
          setRooms((data ?? []) as RoomSummary[])
        }
      } catch (error) {
        if (active) {
          setRoomsError('ルーム一覧を読み込めませんでした: ' + getErrorMessage(error))
        }
      } finally {
        if (active) setLoadingRooms(false)
      }
    }

    void loadInitialRooms()

    return () => {
      active = false
    }
  }, [fetchRooms])

  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#fff' }}>
      <h1>9ボール スコアボード</h1>

      <section
        style={{
          maxWidth: 760,
          margin: '24px auto 0',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <h2>作成済みのルーム（最新20件）</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href="/create-room"
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                background: '#315f36',
                color: '#fff',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              新規作成
            </Link>
            <button onClick={() => void loadRooms()} disabled={loadingRooms}>
              更新
            </button>
          </div>
        </div>

        {roomsError && <p role="alert">{roomsError}</p>}
        {loadingRooms ? (
          <p>読み込み中...</p>
        ) : rooms.length === 0 ? (
          <p>ルームはまだありません。</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {rooms.map((room) => {
              const players = (room.players ?? [])
                .map((player) => `${player.name ?? 'プレイヤー'}（${player.target ?? 3}）`)
                .join('／')
              const gameName = room.game_type
                ? gameNames[room.game_type] ?? room.game_type
                : '種目未設定'
              const roomName = room.room_name?.trim() || room.room_id

              return (
                <div
                  key={room.room_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                    padding: 16,
                    border: '1px solid #555',
                    borderRadius: 8,
                    background: '#171a25',
                  }}
                >
                  <div>
                    <div style={{ marginTop: 4, color: '#bbb', fontSize: 13 }}>
                      部屋ID：{room.room_id}
                    </div>
                    <strong style={{ display: 'block', marginTop: 6, color: '#fff' }}>
                      {roomName}／{gameName}
                    </strong>
                    <div style={{ marginTop: 6, color: '#bbb' }}>
                      {players || 'プレイヤー情報なし'}
                      {room.finished ? ' ・ 終了' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link
                      href={`/room/${room.room_id}`}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 6,
                        background: '#333',
                        color: '#fff',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      参加
                    </Link>
                    <button
                      onClick={() => void editRoomName(room)}
                      disabled={deletingRoomId !== null}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 6,
                      }}
                    >
                      編集
                    </button>
                    <button
                      onClick={() => void deleteRoom(room.room_id)}
                      disabled={deletingRoomId !== null}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 6,
                        background: '#8b1e1e',
                        color: '#fff',
                        border: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {deletingRoomId === room.room_id ? '削除中...' : '削除'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

    </div>
  )
}
