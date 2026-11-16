'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { QRCodeSVG } from 'qrcode.react'

type RoomParams = {
  room_id: string
}

type RoomPlayer = {
  id: number
  name: string
  score: number
  target?: number
  timer?: number
  timer_running?: boolean
  timer_remaining?: number
  timer_deadline?: number | null
  color: string
  is_active?: boolean
  is_winner?: boolean
}

type Room = {
  room_id: string
  room_name?: string | null
  players: RoomPlayer[]
  turn: number
  game_type?: string
  winner?: string | null
  finished?: boolean
  history?: unknown
  shot_clock?: {
    duration?: number
    remaining?: number
    running?: boolean
  }
  updated_at?: string | null
}

type PlayerDragState = {
  pointerId: number
  playerId: number
  startOrder: number[]
  currentOrder: number[]
  moved: boolean
}

export default function RoomPage({ params }: { params: Promise<RoomParams> }) {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [playerOrder, setPlayerOrder] = useState<number[] | null>(null)
  const [draggedPlayerId, setDraggedPlayerId] = useState<number | null>(null)
  const [isSavingPlayerOrder, setIsSavingPlayerOrder] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [timerNow, setTimerNow] = useState(0)
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null)
  const [editingPlayerName, setEditingPlayerName] = useState('')
  const [editingPlayerTarget, setEditingPlayerTarget] = useState('3')
  const [isSavingPlayer, setIsSavingPlayer] = useState(false)
  const [playerEditError, setPlayerEditError] = useState<string | null>(null)
  const [showPlayerSettings, setShowPlayerSettings] = useState(false)
  const [isResettingMatch, setIsResettingMatch] = useState(false)
  const roomRef = useRef<Room | null>(null)
  const playerDragRef = useRef<PlayerDragState | null>(null)

  useEffect(() => {
    roomRef.current = room
  }, [room])

  // room_id 取得（★型エラーの原因だった部分を修正）
  useEffect(() => {
    params.then((p: RoomParams) => {
      setRoomId(p.room_id)
    })
  }, [params])

  // Subscribe before loading so changes cannot be missed between the initial read and subscription.
  useEffect(() => {
    if (!roomId) return

    let cancelled = false
    let updateSequence = 0
    let loadSequence = 0

    const normalizeRoom = (roomData: Room): Room => ({
      ...roomData,
      players: ((roomData.players || []) as Array<RoomPlayer & { handicap?: number }>).map((p) => {
        const remaining = p.timer_remaining ?? roomData.shot_clock?.duration ?? 60
        const normalizedPlayer = {
          ...p,
          target: p.target ?? 3,
          timer_running: p.timer_running ?? false,
          timer_remaining: remaining,
          timer_deadline:
            p.timer_deadline ?? (p.timer_running ? Date.now() + remaining * 1000 : null),
        }

        delete normalizedPlayer.handicap
        return normalizedPlayer
      }),
    })

    const loadRoom = async () => {
      const requestSequence = ++loadSequence
      const requestUpdateSequence = updateSequence
      const { data, error } = await supabase
        .from('billiard_rooms')
        .select('*')
        .eq('room_id', roomId)
        .single()

      if (error) {
        console.error('Failed to load room:', error)
        return
      }

      if (
        !cancelled &&
        data &&
        requestSequence === loadSequence &&
        requestUpdateSequence === updateSequence
      ) {
        setRoom(normalizeRoom(data))
      }
    }

    void loadRoom()

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'billiard_rooms',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newRoom = payload.new as Room
          if (!newRoom?.room_id) return

          updateSequence += 1
          setRoom(normalizeRoom(newRoom))
        }
      )
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          void loadRoom()
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Supabase Realtime subscription failed:', status, error)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [roomId])

  // Update timer displays locally; do not write the whole room to the database every second.
  useEffect(() => {
    const updateTime = () => setTimerNow(Date.now())
    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [])

  const startEditingPlayer = (player: RoomPlayer) => {
    setEditingPlayerId(player.id)
    setEditingPlayerName(player.name)
    setEditingPlayerTarget(String(player.target ?? 3))
    setPlayerEditError(null)
    setShowPlayerSettings(true)
  }

  const closePlayerSettings = () => {
    if (isSavingPlayer) return
    setShowPlayerSettings(false)
    setEditingPlayerId(null)
    setPlayerEditError(null)
  }

  const savePlayerEdits = async (playerId: number) => {
    if (!room || !roomId) return

    const name = editingPlayerName.trim()
    if (!name || name.length > 40) {
      setPlayerEditError('プレイヤー名は1〜40文字で入力してください。')
      return
    }
    const target = Number(editingPlayerTarget)
    if (
      !Number.isInteger(target) ||
      target < 1 ||
      target > 99
    ) {
      setPlayerEditError('セット数は1〜99で入力してください。')
      return
    }

    const updatedPlayers = room.players.map((player) =>
      player.id === playerId
        ? { ...player, name, target }
        : player
    )

    setIsSavingPlayer(true)
    setPlayerEditError(null)
    try {
      const { error } = await supabase
        .from('billiard_rooms')
        .update({ players: updatedPlayers })
        .eq('room_id', roomId)

      if (error) {
        setPlayerEditError('変更を保存できませんでした: ' + error.message)
        return
      }

      setRoom((currentRoom) =>
        currentRoom ? { ...currentRoom, players: updatedPlayers } : currentRoom
      )
      setEditingPlayerId(null)
      setShowPlayerSettings(false)
    } catch (error) {
      setPlayerEditError(
        '変更を保存できませんでした: ' +
          (error instanceof Error ? error.message : '不明なエラーが発生しました。')
      )
    } finally {
      setIsSavingPlayer(false)
    }
  }

  // 手番
  const handlePlayerClick = async (playerId: number) => {
    if (!room || !roomId) return

    const updatedPlayers = room.players.map((p) => ({
      ...p,
      is_active: p.id === playerId,
    }))

    await supabase
      .from('billiard_rooms')
      .update({ turn: playerId, players: updatedPlayers })
      .eq('room_id', roomId)

    setRoom({ ...room, turn: playerId, players: updatedPlayers })
  }

  // スコア +1
  const addScore = async (playerId: number) => {
    if (!room || !roomId) return

    const updatedPlayers = room.players.map((p) =>
      p.id === playerId ? { ...p, score: p.score + 1 } : p
    )

    const { data, error } = await supabase
      .from('billiard_rooms')
      .update({ players: updatedPlayers })
      .eq('room_id', roomId)
      .select('*')
      .single()

    if (error) {
      alert('スコアを保存できませんでした: ' + error.message)
      return
    }

    setRoom(data)
  }

  // スコア -1
  const subScore = async (playerId: number) => {
    if (!room || !roomId) return

    const updatedPlayers = room.players.map((p) =>
      p.id === playerId ? { ...p, score: Math.max(0, p.score - 1) } : p
    )

    const { data, error } = await supabase
      .from('billiard_rooms')
      .update({ players: updatedPlayers })
      .eq('room_id', roomId)
      .select('*')
      .single()

    if (error) {
      alert('スコアを保存できませんでした: ' + error.message)
      return
    }

    setRoom(data)
  }

  // タイマー開始/停止
  const togglePlayerTimer = async (playerId: number) => {
    if (!room || !roomId) return

    const now = Date.now()
    const updatedPlayers = room.players.map((p) => {
      if (p.id !== playerId) return p

      let remaining =
        p.timer_running && p.timer_deadline != null
          ? Math.max(0, Math.ceil((p.timer_deadline - now) / 1000))
          : p.timer_remaining ?? room.shot_clock?.duration ?? 60
      const isRunning = p.timer_running && remaining > 0
      const shouldRun = !isRunning

      if (shouldRun && remaining === 0) {
        remaining = room.shot_clock?.duration ?? 60
      }

      return {
        ...p,
        timer_running: shouldRun,
        timer_remaining: remaining,
        timer_deadline: shouldRun ? now + remaining * 1000 : null,
      }
    })

    const { error } = await supabase
      .from('billiard_rooms')
      .update({ players: updatedPlayers })
      .eq('room_id', roomId)

    if (error) {
      alert('タイマーを保存できませんでした: ' + error.message)
      return
    }

    setRoom({ ...room, players: updatedPlayers })
  }

  const resetMatch = async () => {
    if (!room || !roomId || isResettingMatch) return
    if (!window.confirm('全プレイヤーのスコアとタイマーをリセットします。よろしいですか？')) {
      return
    }

    const duration = room.shot_clock?.duration ?? 60
    const updatedPlayers = room.players.map((player) => ({
      ...player,
      score: 0,
      timer: 0,
      timer_running: false,
      timer_remaining: duration,
      timer_deadline: null,
    }))
    const updatedShotClock = {
      ...room.shot_clock,
      remaining: duration,
      running: false,
    }

    setIsResettingMatch(true)
    try {
      const { error } = await supabase
        .from('billiard_rooms')
        .update({ players: updatedPlayers, shot_clock: updatedShotClock })
        .eq('room_id', roomId)

      if (error) {
        alert('試合をリセットできませんでした: ' + error.message)
        return
      }

      setRoom((currentRoom) =>
        currentRoom
          ? { ...currentRoom, players: updatedPlayers, shot_clock: updatedShotClock }
          : currentRoom
      )
    } catch (error) {
      alert(
        '試合をリセットできませんでした: ' +
          (error instanceof Error ? error.message : '不明なエラーが発生しました。')
      )
    } finally {
      setIsResettingMatch(false)
    }
  }

  const startPlayerReorder = (
    event: ReactPointerEvent<HTMLButtonElement>,
    playerId: number
  ) => {
    if (!roomId || isSavingPlayerOrder || isResettingMatch || !event.isPrimary) return

    const currentRoom = roomRef.current
    if (!currentRoom) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const startOrder = currentRoom.players.map((player) => player.id)
    playerDragRef.current = {
      pointerId: event.pointerId,
      playerId,
      startOrder,
      currentOrder: startOrder,
      moved: false,
    }
    setPlayerOrder(startOrder)
    setDraggedPlayerId(playerId)
  }

  const movePlayerReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = playerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-player-id]')
    const targetId = Number(target?.dataset.playerId)
    if (!Number.isInteger(targetId) || targetId === drag.playerId) return

    const fromIndex = drag.currentOrder.indexOf(drag.playerId)
    const targetIndex = drag.currentOrder.indexOf(targetId)
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return

    const nextOrder = [...drag.currentOrder]
    nextOrder.splice(fromIndex, 1)
    nextOrder.splice(targetIndex, 0, drag.playerId)
    drag.currentOrder = nextOrder
    drag.moved = true
    setPlayerOrder(nextOrder)
  }

  const finishPlayerReorder = async (pointerId: number) => {
    const drag = playerDragRef.current
    if (!drag || drag.pointerId !== pointerId) return

    playerDragRef.current = null
    setDraggedPlayerId(null)

    const latestRoom = roomRef.current
    const orderChanged =
      drag.currentOrder.length !== drag.startOrder.length ||
      drag.currentOrder.some((playerId, index) => playerId !== drag.startOrder[index])

    if (!drag.moved || !orderChanged || !latestRoom || !roomId) {
      setPlayerOrder(null)
      return
    }

    if (
      latestRoom.players.length !== drag.startOrder.length ||
      latestRoom.players.some((player) => !drag.startOrder.includes(player.id))
    ) {
      setPlayerOrder(null)
      alert('プレイヤー情報が更新されたため、並べ替えを中止しました。')
      return
    }

    const playersById = new Map(latestRoom.players.map((player) => [player.id, player]))
    const reorderedPlayers = drag.currentOrder
      .map((playerId) => playersById.get(playerId))
      .filter((player): player is RoomPlayer => player !== undefined)
    if (reorderedPlayers.length !== drag.currentOrder.length) {
      setPlayerOrder(null)
      alert('プレイヤー情報が更新されたため、並べ替えを中止しました。')
      return
    }

    setIsSavingPlayerOrder(true)
    try {
      const { error } = await supabase
        .from('billiard_rooms')
        .update({ players: reorderedPlayers })
        .eq('room_id', roomId)

      if (error) {
        setPlayerOrder(null)
        alert('並べ替えを保存できませんでした: ' + error.message)
        return
      }

      setRoom((currentRoom) =>
        currentRoom
          ? { ...currentRoom, players: reorderedPlayers }
          : currentRoom
      )
      setPlayerOrder(null)
    } catch (error) {
      setPlayerOrder(null)
      alert(
        '並べ替えを保存できませんでした: ' +
          (error instanceof Error ? error.message : '不明なエラーが発生しました。')
      )
    } finally {
      setIsSavingPlayerOrder(false)
    }
  }

  const cancelPlayerReorder = (pointerId: number) => {
    if (playerDragRef.current?.pointerId !== pointerId) return
    playerDragRef.current = null
    setPlayerOrder(null)
    setDraggedPlayerId(null)
  }

  if (!room) return <div style={{ padding: 20 }}>部屋が見つかりません</div>

  const roomPlayers = room.players || []
  const players = roomPlayers
  const getTimerRemaining = (player: RoomPlayer) => {
    if (!player.timer_running || player.timer_deadline == null || timerNow === 0) {
      return player.timer_remaining ?? room.shot_clock?.duration ?? 60
    }

    return Math.max(0, Math.ceil((player.timer_deadline - timerNow) / 1000))
  }
  const focusedPlayer =
    players.find((player) => player.id === room.turn) ??
    players.find((player) => player.is_active) ??
    players[0]
  const focusedTimerRunning = focusedPlayer
    ? focusedPlayer.timer_running && getTimerRemaining(focusedPlayer) > 0
    : false
  const editedPlayer = players.find((player) => player.id === editingPlayerId)
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'

  return (
    <div className="room-root">
      <div className="header">
        <div className="header-left">
          <h1>Room：{room.room_name?.trim() || room.room_id}</h1>
          <button className="qr-btn" onClick={() => setShowQR(true)}>
            QRコード
          </button>
        </div>
        <div className="header-center">
          <button
            className="main-timer-btn"
            onClick={() => {
              if (focusedPlayer) void togglePlayerTimer(focusedPlayer.id)
            }}
            disabled={
              !focusedPlayer ||
              isResettingMatch ||
              isSavingPlayerOrder ||
              draggedPlayerId !== null
            }
          >
            {focusedTimerRunning ? '停止' : '再開'}
          </button>
          <button
            className="reset-match-btn"
            onClick={() => void resetMatch()}
            disabled={isResettingMatch || isSavingPlayerOrder || draggedPlayerId !== null}
          >
            {isResettingMatch ? 'リセット中...' : '試合リセット'}
          </button>
        </div>
        <div className="header-right">
          <Link className="header-nav-btn" href="/">
            一覧
          </Link>
          <button
            className="header-nav-btn"
            onClick={() => {
              if (focusedPlayer) startEditingPlayer(focusedPlayer)
            }}
            disabled={!focusedPlayer || isSavingPlayerOrder || draggedPlayerId !== null}
          >
            設定
          </button>
        </div>
      </div>

      {showQR && (
        <div className="modal-bg" onClick={() => setShowQR(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <QRCodeSVG value={`${baseUrl}/room/${roomId}`} size={220} />
            <button className="close-btn" onClick={() => setShowQR(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {showPlayerSettings && editedPlayer && (
        <div className="modal-bg" onClick={closePlayerSettings}>
          <div
            className="modal player-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="player-settings-title">{editedPlayer.name}の設定</h2>
            <label>
              プレイヤー名
              <input
                type="text"
                value={editingPlayerName}
                onChange={(event) => setEditingPlayerName(event.target.value)}
                maxLength={40}
              />
            </label>
            <label>
              セット
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={editingPlayerTarget}
                onChange={(event) => setEditingPlayerTarget(event.target.value)}
              />
            </label>
            {playerEditError && (
              <p role="alert" style={{ color: '#b00020', margin: '12px 0 0' }}>
                {playerEditError}
              </p>
            )}
            <div className="player-settings-actions">
              <button
                type="button"
                onClick={() => void savePlayerEdits(editedPlayer.id)}
                disabled={isSavingPlayer}
              >
                {isSavingPlayer ? '保存中...' : '保存'}
              </button>
              <button type="button" onClick={closePlayerSettings} disabled={isSavingPlayer}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="players">
        {players.map((p: RoomPlayer) => (
          <div
            key={p.id}
            className="player-card"
            data-player-id={p.id}
            onClick={() => {
              if (!isResettingMatch && !isSavingPlayerOrder && draggedPlayerId === null) {
                void handlePlayerClick(p.id)
              }
            }}
            style={{
              order: playerOrder?.includes(p.id) ? playerOrder.indexOf(p.id) : undefined,
              border: p.is_active ? `4px solid ${p.color}` : '2px solid #333',
              opacity: draggedPlayerId === p.id ? 0.65 : 1,
            }}
          >
            <div className="player-heading-row">
              <button
                type="button"
                className="drag-handle"
                aria-label={`${p.name}をドラッグして並べ替え`}
                title="ドラッグして順番を入れ替え"
                disabled={isResettingMatch || isSavingPlayerOrder}
                onPointerDown={(event) => startPlayerReorder(event, p.id)}
                onPointerMove={movePlayerReorder}
                onPointerUp={(event) => {
                  event.stopPropagation()
                  void finishPlayerReorder(event.pointerId)
                }}
                onPointerCancel={(event) => {
                  event.stopPropagation()
                  cancelPlayerReorder(event.pointerId)
                }}
                onLostPointerCapture={(event) => cancelPlayerReorder(event.pointerId)}
                onClick={(event) => event.stopPropagation()}
              >
                ⋮⋮
              </button>
              <div className="player-heading-content">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0,
                    background: '#333',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '16px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {'セット：'}<span style={{ fontSize: '22px' }}>{p.target ?? 3}</span>
                </span>
                <h2 className="player-name">{p.name}</h2>
              </div>
            </div>

            <div className="score-row">
              <div className="score" style={{ color: p.color }}>
                {p.score}
              </div>

              <div className={`score-buttons ${p.id === 1 ? 'red' : 'blue'}`}>
                <button className="score-btn up"
                  onClick={(e) => {
                    e.stopPropagation()
                    addScore(p.id)
                  }}
                  disabled={isResettingMatch || isSavingPlayerOrder}
                >
                  △
                </button>
                <button className="score-btn down"
                  onClick={(e) => {
                    e.stopPropagation()
                    subScore(p.id)
                  }}
                  disabled={isResettingMatch || isSavingPlayerOrder}
                >
                  ▽
                </button>
              </div>
            </div>

            <div className="timer-row">
              <span className="timer-label">タイマー</span>

              <span className="timer-value">
                {getTimerRemaining(p)} 秒
              </span>
            </div>

          </div>
        ))}
      </div>

      <style jsx>{`
        .room-root {
          padding: 10px;
          overflow-y: auto;
        }

        .header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: center;
          gap: 12px;
          padding: 2px 0;
          margin-bottom: 10px;
        }

        .header-left,
        .header-right,
        .header-center {
          display: flex;
          align-items: center;
        }

        .header-left {
          gap: 10px;
          min-width: 0;
        }

        .header-center {
          justify-content: center;
          gap: 8px;
        }

        .header-right {
          justify-content: flex-end;
          gap: 8px;
        }

        .header h1 {
          margin: 0;
          padding: 0;
          line-height: 1;
          color: #fff;
          font-size: 20px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .qr-btn {
          padding: 3px 12px;
          font-size: 14px;
          border-radius: 6px;
          line-height: 1.2;
          white-space: nowrap;
        }

        .main-timer-btn {
          min-width: 96px;
          padding: 8px 20px;
          border-radius: 8px;
          font-size: 18px;
        }

        .reset-match-btn {
          padding: 8px 12px;
          border: 0;
          border-radius: 8px;
          background: #8b1e1e;
          color: #fff;
          font-size: 14px;
          white-space: nowrap;
          cursor: pointer;
        }

        .header-nav-btn {
          display: inline-flex;
          align-items: center;
          padding: 6px 12px;
          border: 0;
          border-radius: 6px;
          background: #333;
          color: #fff;
          font-size: 14px;
          text-decoration: none;
          white-space: nowrap;
          cursor: pointer;
        }

        @media (max-width: 640px) {
          .header {
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas:
              'left right'
              'center center';
            row-gap: 8px;
          }

          .header-left {
            grid-area: left;
          }

          .header-center {
            grid-area: center;
          }

          .header-right {
            grid-area: right;
          }
        }

        .players {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        @media (orientation: landscape) {
          .players {
            flex-direction: row;
            align-items: stretch;
          }
        }

        .player-card {
          background: #000;
          padding: 10px;
          border-radius: 12px;
          color: #fff;
          cursor: pointer;
          flex: 1;
          min-height: unset;
          height: auto;
        }

        .player-heading-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          min-width: 0;
        }

        .player-heading-content {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }

        .drag-handle {
          flex: none;
          padding: 6px 5px;
          border: 0;
          border-radius: 6px;
          background: #333;
          color: #fff;
          cursor: grab;
          touch-action: none;
          user-select: none;
        }

        .drag-handle:active {
          cursor: grabbing;
        }

        .player-name {
          flex: 1;
          min-width: 0;
          margin: 0;
          font-size: clamp(16px, 2.2vw, 36px);
          font-weight: bold;   /* ★ 視認性アップ */
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: center;
          white-space: nowrap;
        }

        .score-row {
          display: flex;
          align-items: center;
          justify-content: space-between; /* ★ 左右に分ける */
          margin-top: 10px;
        }

        .score {
          flex: 1;
          text-align: center;     /* ★ 数値を中央に */
          font-weight: bold;
          font-size: 90px;
        }

        .score-buttons {
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column; /* ★ 縦並び */
          gap: 10px;
          align-items: flex-end;  /* ★ 右端に寄せる */
        }

        .score-btn {
          background: #000;
          color: #fff;
          border: none;          /* ★ 枠線を消してスッキリ */
          padding: 12px 18px;
          font-size: 28px;       /* ★ △ ▽ を大きくして押しやすく */
          border-radius: 10px;
          font-weight: bold;
        }

        .score-buttons button {
          padding: 10px 16px;
          font-size: 20px;
        }

        .score-buttons.red .score-btn {
          background: #000;   /* 赤 */
          color: #c00;
        }

        .score-buttons.blue .score-btn {
          background: #000; /* 青 */
          color: #0066ff;
        }

        .timer-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 20#px;
        }

        .timer-label {
          font-size: 16px;
          opacity: 0.8;
        }

        .timer-value {
          flex: 1;
          text-align: center;
          font-size: 32px;      /* ★ 数値を大きく */
          font-weight: bold;
        }

        .modal-bg {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .modal {
          background: #fff;
          padding: 20px;
          border-radius: 12px;
          text-align: center;
        }

        .player-settings-modal {
          width: min(420px, calc(100vw - 32px));
          box-sizing: border-box;
          color: #111;
          text-align: left;
        }

        .player-settings-modal h2 {
          margin: 0 0 16px;
          color: #111;
          font-size: 22px;
        }

        .player-settings-modal label {
          display: grid;
          gap: 6px;
          margin-top: 12px;
        }

        .player-settings-modal input {
          box-sizing: border-box;
          width: 100%;
          padding: 8px;
        }

        .player-settings-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 18px;
        }

        .player-settings-actions button {
          padding: 8px 14px;
        }

        .close-btn {
          margin-top: 20px;
          padding: 10px 20px;
          font-size: 18px;
        }
      `}</style>
    </div>
  )
}
